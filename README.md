# Tiny stack virtual machine

[![make.fun bounty](https://make.fun/badge/tiny-stack-vm-01-run-20261122.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)

A small interpreter for make.fun's tiny stack ISA (version 1), in one TypeScript file.
It runs every program in the input directory and writes the exact bytes the program
produced and the exit code it ended with, traps included.

    MAKEFUN_INPUT_DIR=<input dir> MAKEFUN_OUTPUT_DIR=<output dir> node main.ts

Entered in [Build a tiny stack virtual machine, 22 November 2026](https://make.fun/bounty/tiny-stack-vm-01-run-20261122) on [make.fun](https://make.fun). Referral: leekun-poko
