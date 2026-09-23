// The categories screen edits names in place instead of in a sheet: tapping a
// row turns its name into a field, and the header '+' inserts an empty row
// above the list. These are the rules for what finishing such a field means,
// and for when the rest of the list has to hold still.
//
// Rename: keyboard done with an empty field puts the old name back, done with
// the same name (after trimming) just closes, anything else saves the trimmed
// name. Add: done with an empty field drops the row without a request.
//
// The comparison is exact after trimming. "Drinks" -> "drinks" is a rename the
// owner asked for, so a change of case is saved, not swallowed.

export type RenameOutcome = { kind: 'close' } | { kind: 'revert' } | { kind: 'save'; name: string };

/** What finishing a rename does: '' after trimming reverts, the same name closes, anything else saves the trimmed name. */
export function renameOutcome(original: string, draft: string): RenameOutcome {
  const name = draft.trim();
  if (name === '') return { kind: 'revert' };
  if (name === original.trim()) return { kind: 'close' };
  return { kind: 'save', name };
}

export type AddOutcome = { kind: 'discard' } | { kind: 'create'; name: string };

/** What finishing the add row does: '' after trimming discards it, anything else creates the trimmed name. */
export function addOutcome(draft: string): AddOutcome {
  const name = draft.trim();
  if (name === '') return { kind: 'discard' };
  return { kind: 'create', name };
}

export type InlineMode =
  | { kind: 'idle' }
  | { kind: 'renaming'; id: number; draft: string }
  | { kind: 'adding'; draft: string };

/** True while a name field is open: no row may swipe, lift, or take a tap until it closes. */
export function inlineLocked(mode: InlineMode): boolean {
  return mode.kind !== 'idle';
}
