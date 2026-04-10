// Renderuje tekst z {FLG:VALUE} / {{FLG:VALUE}} — blur + hover reveal
export default function FlagText({ text }: { text: string }) {
  const parts = text.split(/({{FLG:[^}]+}}|\{FLG:[^}]+\})/g);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^{{FLG:([^}]+)}}$/) || part.match(/^\{FLG:([^}]+)\}$/);
        if (m) {
          const isDouble = part.startsWith('{{');
          return (
            <span key={i}>
              {isDouble ? '{{FLG:' : '{FLG:'}
              <span className="blur-sm transition-all duration-300 hover:blur-none select-none">{m[1]}</span>
              {isDouble ? '}}' : '}'}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
