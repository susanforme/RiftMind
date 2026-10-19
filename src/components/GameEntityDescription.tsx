import { Fragment, type ReactNode } from 'react';

// Game catalogues use HTML plus Riot-specific tags. Render only text and a small
// presentation allowlist; never mount upstream HTML, attributes, images or links.
export function GameEntityDescription({ description }: { description: string }) {
  const document = new window.DOMParser().parseFromString(description, 'text/html');
  function renderNodes(nodes: NodeListOf<ChildNode>): ReactNode {
    return Array.from(nodes).map((node, index) => {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return null;
      const element = node as Element;
      const tag = element.tagName.toLowerCase();
      if (['script', 'style', 'iframe', 'object', 'img', 'svg'].includes(tag)) return null;
      if (tag === 'br' || tag === 'hr') return <br key={index} />;
      const children = renderNodes(element.childNodes);
      if (['b', 'strong', 'attention', 'passive', 'active'].includes(tag)) {
        return (
          <strong key={index} className="font-semibold text-foreground">
            {children}
          </strong>
        );
      }
      if (['p', 'div', 'li'].includes(tag)) {
        return (
          <span key={index} className="block">
            {children}
          </span>
        );
      }
      return <Fragment key={index}>{children}</Fragment>;
    });
  }
  return (
    <div className="text-sm leading-relaxed text-muted-foreground">
      {renderNodes(document.body.childNodes)}
    </div>
  );
}
