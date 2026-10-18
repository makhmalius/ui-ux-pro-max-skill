// Guard for scripts that walk `git log --all`: a shallow clone silently yields
// an incomplete result set. Pass the output of `git rev-parse --is-shallow-repository`.
export function assertFullHistory(isShallowOutput) {
  if (String(isShallowOutput).trim() === 'true') {
    throw new Error(
      'This is a shallow git clone, so history-derived output would be incomplete. ' +
        'Run `git fetch --unshallow` (or re-clone with full history) and retry.',
    );
  }
}
