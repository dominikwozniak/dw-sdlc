// A command as the line a dev pastes into a POSIX shell: what an answer hands the dev to run.

/** The words as one POSIX shell command line, each word that needs it single-quoted. */
export function shellLine(words: string[]): string {
  return words.map((word) => (/^[\w./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)).join(" ")
}
