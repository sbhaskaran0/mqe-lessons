// Notation help: chips for the symbols a step's math uses, and the drawer with the note's full table (whose math
// explains its own symbols on hover too).
import { useId, useState } from "react";
import { Md, useNoteLinkClick } from "../app/Md";
import { Icon, Modal } from "../app/ui";
import type { NotationRow } from "../ir";
import { FromNote, SymbolDetail } from "./SymbolDetail";
import { PlainMath, SymbolScope } from "./SymbolHover";

export function SymbolChips({ symbols, notation }: { symbols: string[]; notation: NotationRow[] }) {
  const id = useId();
  const [open, setOpen] = useState<number | null>(null);
  const onClick = useNoteLinkClick();
  const rows = symbols.map((tex) => notation.find((r) => r.tex === tex)).filter((r): r is NotationRow => r !== undefined);
  if (rows.length === 0) return null;
  const row = open === null ? undefined : rows[open];
  return (
    <PlainMath>
      <div className="symbol-chips" onClick={onClick}>
        <span className="symbol-chips-label">Symbols</span>
        <ul className="symbol-chip-list">
          {rows.map((r, i) => (
            <li key={r.tex}>
              <button
                type="button"
                className="symbol-chip"
                aria-expanded={open === i}
                aria-controls={`${id}-detail`}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <Md md={r.tex} inline />
              </button>
            </li>
          ))}
        </ul>
        {row ? (
          <div id={`${id}-detail`} className="symbol-detail" role="region" aria-label="Symbol meaning">
            <SymbolDetail row={row} />
          </div>
        ) : null}
      </div>
    </PlainMath>
  );
}

export function SymbolsDrawer({ open, onClose, notation, intro, title }: { open: boolean; onClose: () => void; notation: NotationRow[]; intro?: string | undefined; title: string }) {
  const onClick = useNoteLinkClick();
  return (
    <Modal open={open} onClose={onClose} label={`Symbols in ${title}`} variant="sheet" className="symbols-drawer">
      <header className="sheet-head">
        <h2>Symbols</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close symbols">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-scroll" onClick={onClick}>
        <SymbolScope notation={notation}>
          {intro ? <Md md={intro} className="symbols-intro" /> : null}
          <table className="notation-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Meaning</th>
                <th scope="col">Kind</th>
                <th scope="col">Typical value</th>
              </tr>
            </thead>
            <tbody>
              {notation.map((r) => (
                <tr key={r.tex}>
                  <th scope="row">
                    <Md md={r.tex} inline />
                  </th>
                  <td>
                    <Md md={r.meaning} inline />
                    {r.from ? (
                      <>
                        {" "}
                        <FromNote slug={r.from} />
                      </>
                    ) : null}
                  </td>
                  <td>{r.kind}</td>
                  <td>
                    <Md md={r.typical} inline />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SymbolScope>
      </div>
    </Modal>
  );
}
