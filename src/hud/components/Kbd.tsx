/** Renders an Electron accelerator as keycaps: `Control+Shift+C` -> Ctrl Shift C. */

const PRETTY: Record<string, string> = {
  Control: 'Ctrl',
  CommandOrControl: 'Ctrl',
  Return: '↵',
  Enter: '↵',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Escape: 'Esc',
};

export function Kbd({ chord }: { chord: string | undefined }): JSX.Element | null {
  if (!chord) return null;
  return (
    <span className="kbd" aria-hidden="true">
      {chord.split('+').map((key, index) => (
        <kbd key={`${key}-${index}`}>{PRETTY[key] ?? key}</kbd>
      ))}
    </span>
  );
}
