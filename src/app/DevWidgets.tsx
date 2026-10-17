// #/dev/widgets: the widget runtime's Gallery over the live export, for checking every widget and every view that
// places it in one page. Loaded on demand, so lessons never download it.
import { useContent } from "../content/context";
import { loadNote } from "../content/store";
import { Gallery } from "../widgets/Gallery";
import { useDocumentTitle } from "./ui";

export default function DevWidgets() {
  const content = useContent();
  useDocumentTitle("Widgets");
  return (
    <div className="page dev-widgets">
      <p className="page-kicker">Developer</p>
      <Gallery index={content.index} contentBase={content.contentBase} loadNote={loadNote} />
    </div>
  );
}
