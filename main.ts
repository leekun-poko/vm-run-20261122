// A tiny stack virtual machine for the make.fun tiny stack ISA (version 1).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode facts by byte: [immediate bytes, pops, pushes]; null is not an opcode (traps 5).
// Packed five characters per opcode: two hex digits for the byte, then imm, pops, pushes, for
// HALT, PUSH8, PUSH32, POP, DUP, SWAP, OVER, ROT, NEG, NOT, JMP, JZ, JNZ, CALL, RET, LOAD,
// STORE, PRINT, PUTC, IN, EXIT. The rest of 0x10-0x22 (not 0x1f) are binary ops.
const META: ([number, number, number] | null)[] = new Array(256).fill(null);
const PACKED =
  '00000 01101 02401 03010 04012 05022 06023 07033 17011 1b011 30200 31210 32210 33200 ' +
  '34000 40011 41020 50010 51010 52001 53010';
for (const s of PACKED.split(' ')) META[parseInt(s.slice(0, 2), 16)] = [Number(s[2]), Number(s[3]), Number(s[4])];
for (let b = 0x10; b <= 0x22; b++) if (b !== 0x1f && META[b] === null) META[b] = [0, 2, 1];

// Runs one program to its end. A trap ends it at once, its code becoming the exit code.
function run(prog: Uint8Array, input: Uint8Array): { out: Uint8Array; exit: number } {
  const S = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let csp = 0;
  const mem = new Int32Array(256);
  const out = new Uint8Array(65_536);
  let olen = 0;
  let inPos = 0;
  let pc = 0;
  let steps = 0;
  const end = (exit: number) => ({ out: out.slice(0, olen), exit });

  for (;;) {
    if (steps === 1_000_000) return end(10);
    if (pc < 0 || pc >= prog.length) return end(9);
    const byte = prog[pc];
    const meta = META[byte];
    if (meta === null) return end(5);
    const [imm, pops, pushes] = meta;
    if (pc + imm >= prog.length) return end(9);
    steps++;
    if (sp < pops) return end(2);
    if (sp - pops + pushes > 256) return end(3);
    const next = pc + 1 + imm;
    pc = next;

    switch (byte) {
      case 0x00: return end(0); // HALT
      case 0x01: S[sp++] = (prog[next - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 0x02: // PUSH32, little-endian
        S[sp++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24);
        break;
      case 0x03: sp--; break; // POP
      case 0x04: S[sp] = S[sp - 1]; sp++; break; // DUP
      case 0x05: { // SWAP
        const t = S[sp - 1];
        S[sp - 1] = S[sp - 2];
        S[sp - 2] = t;
        break;
      }
      case 0x06: S[sp] = S[sp - 2]; sp++; break; // OVER
      case 0x07: { // ROT: ( a b c -- b c a )
        const a = S[sp - 3];
        S[sp - 3] = S[sp - 2];
        S[sp - 2] = S[sp - 1];
        S[sp - 1] = a;
        break;
      }
      case 0x30: case 0x31: case 0x32: { // JMP, JZ, JNZ: target = next + signed offset
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (byte !== 0x30) {
          const v = S[--sp];
          take = byte === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel; // a bad target traps at the next step, not here
        break;
      }
      case 0x33: // CALL: the immediate is an unsigned absolute address
        if (csp === 64) return end(7);
        C[csp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34: // RET
        if (csp === 0) return end(8);
        pc = C[--csp];
        break;
      case 0x40: case 0x41: { // LOAD and STORE share the address check (traps 6)
        const addr = S[sp - 1];
        if (addr < 0 || addr >= 256) return end(6);
        if (byte === 0x40) S[sp - 1] = mem[addr];
        else {
          const v = S[sp - 2];
          sp -= 2;
          mem[addr] = v;
        }
        break;
      }
      case 0x50: { // PRINT: decimal ASCII; past the output limit it writes nothing, traps 11
        const text = String(S[sp - 1]);
        if (olen + text.length > 65_536) return end(11);
        sp--;
        for (let i = 0; i < text.length; i++) out[olen++] = text.charCodeAt(i);
        break;
      }
      case 0x51: // PUTC
        if (olen + 1 > 65_536) return end(11);
        out[olen++] = S[--sp] & 255;
        break;
      case 0x52: // IN: -1 at end of input
        S[sp++] = inPos < input.length ? input[inPos++] : -1;
        break;
      case 0x53: return end(S[--sp] & 255); // EXIT: the code is the low byte
      case 0x17: S[sp - 1] = (-S[sp - 1]) | 0; break; // NEG
      case 0x1b: S[sp - 1] = ~S[sp - 1]; break; // NOT
      default: {
        // The remaining opcodes are binary: pop b (the top), then a, push r.
        const b = S[sp - 1];
        const a = S[sp - 2];
        let r = 0;
        switch (byte) {
          case 0x10: r = (a + b) | 0; break; // ADD
          case 0x11: r = (a - b) | 0; break; // SUB
          case 0x12: r = Math.imul(a, b); break; // MUL
          case 0x13: if (b === 0) return end(4); r = (a / b) | 0; break; // DIV
          case 0x14: if (b === 0) return end(4); r = b === -1 ? 0 : (a % b) | 0; break; // MOD
          case 0x15: if (b === 0) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break; // DIVU
          case 0x16: if (b === 0) return end(4); r = ((a >>> 0) % (b >>> 0)) | 0; break; // MODU
          case 0x18: r = a & b; break; // AND
          case 0x19: r = a | b; break; // OR
          case 0x1a: r = a ^ b; break; // XOR
          case 0x1c: r = a << (b & 31); break; // SHL
          case 0x1d: r = a >> (b & 31); break; // SHR
          case 0x1e: r = (a >>> (b & 31)) | 0; break; // SHRU
          case 0x20: r = a === b ? 1 : 0; break; // EQ
          case 0x21: r = a < b ? 1 : 0; break; // LT
          case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break; // LTU
        }
        sp -= 2;
        S[sp++] = r;
        break;
      }
    }
  }
}

// The driver: run every instance and write stdout.bin and exit.txt (decimal) per instance.
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const program = readFileSync(join(I, id, 'program.bin'));
  let input: Buffer;
  try {
    input = readFileSync(join(I, id, 'input.bin'));
  } catch {
    input = Buffer.alloc(0);
  }
  const { out, exit } = run(program, input);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), out);
  writeFileSync(join(O, id, 'exit.txt'), `${exit}\n`);
}
