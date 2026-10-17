// Inline markdown for the short strings widgets show (goal success and hints, predict questions and options,
// notation meanings): $…$ math through <Tex>, **bold**, *italic*, `code`, and links as their text. Anything else is
// plain text, which React escapes. Full markdown stays with the player's renderer.
import { Fragment, type ReactNode, useMemo } from "react";
import { Tex } from "../../lib/Tex";

const TOKEN = /(\$\$[^$]+?\$\$|(?<![\\$])\$(?!\$)(?:\\\$|[^$\n])+?\$|\*\*[^*]+?\*\*|(?<![*\w])\*[^*\n]+?\*(?![*\w])|`[^`]+`|\[[^\]]+\]\([^)]*\))/g;

function parts(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of md.matchAll(TOKEN)) {
    const tok = m[0];
    const at = m.index;
    if (at > last) out.push(text(md.slice(last, at)));
    const key = `${at}`;
    if (tok.startsWith("$$")) out.push(<Tex key={key} tex={tok.slice(2, -2)} />);
    else if (tok.startsWith("$")) out.push(<Tex key={key} tex={tok.slice(1, -1)} />);
    else if (tok.startsWith("**")) out.push(<strong key={key}>{parts(tok.slice(2, -2))}</strong>);
    else if (tok.startsWith("*")) out.push(<em key={key}>{parts(tok.slice(1, -1))}</em>);
    else if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else out.push(<Fragment key={key}>{parts(tok.slice(1, tok.indexOf("](")))}</Fragment>);
    last = at + tok.length;
  }
  if (last < md.length) out.push(text(md.slice(last)));
  return out;
}

const text = (s: string) => s.replace(/\\([$*_`[\]\\])/g, "$1");

export function MdText({ md, className }: { md: string; className?: string }) {
  const nodes = useMemo(() => parts(md), [md]);
  return <span className={className}>{nodes}</span>;
}
