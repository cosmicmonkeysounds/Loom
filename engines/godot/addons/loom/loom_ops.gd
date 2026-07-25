## Opcode tables, generated-by-hand mirror of `bank/src/ir.ts`.
##
## Kept as a separate class so the VM reads like the spec's instruction
## table. If you change an opcode number here, change it there — the
## conformance suite is what catches a mismatch.
class_name LoomOps
extends RefCounted

const BANK_FORMAT_VERSION := 1
const BANK_ABI_VERSION := 1

const WORDS_PER_INSTRUCTION := 4

# --- instructions ---------------------------------------------------------

const NOP := 0
const NARRATE := 1
const SPEAK := 2
const JUMP := 3
const JUMP_IF_NOT := 4
const MATCH := 5
const MENU := 6
const EACH_VISIT := 7
const AFTER := 8
const LET := 9
const CLEAR_LOCALS := 10
const SET := 11
const SIGNAL := 12
const HOST := 13
const DIVERT := 14
const TUNNEL := 15
const RETURN := 16
const END := 17
const HALT := 18
const CALL_SLOT := 19
const SHUFFLE := 20

# --- host directive modes -------------------------------------------------

const HOST_LEAF := 0
const HOST_BLOCK_BEGIN := 1
const HOST_BLOCK_END := 2

# --- expression opcodes ---------------------------------------------------

const E_NULL := 1
const E_TRUE := 2
const E_FALSE := 3
const E_NUM := 4
const E_STR := 5
const E_PATH := 6
const E_LOCAL := 7
const E_LIST := 8
const E_NEG := 9
const E_NOT := 10
const E_ADD := 11
const E_SUB := 12
const E_MUL := 13
const E_DIV := 14
const E_MOD := 15
const E_EQ := 16
const E_NE := 17
const E_LT := 18
const E_LE := 19
const E_GT := 20
const E_GE := 21
const E_JUMP_FALSE_POP := 22
const E_JUMP_TRUE_POP := 23
const E_TO_BOOL := 24
const E_CALL := 25
const E_COMPREHENSION := 26

## Operand-word count per expression opcode, so a walker can skip an
## opcode it does not implement without desynchronising.
const E_ARITY := {
	1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 0, 10: 0,
	11: 0, 12: 0, 13: 0, 14: 0, 15: 0, 16: 0, 17: 0, 18: 0, 19: 0,
	20: 0, 21: 0, 22: 1, 23: 1, 24: 0, 25: 2, 26: 3,
}

## Step kinds, as they appear in a trace and in the `step` signal.
const STEP_BEAT := "beat"
const STEP_LINE := "line"
const STEP_CHOICE := "choice"
const STEP_DIRECTIVE := "directive"
const STEP_VARSET := "varset"
const STEP_SIGNAL := "signal"
const STEP_IDLE := "idle"
const STEP_DONE := "done"
const STEP_ERROR := "error"
