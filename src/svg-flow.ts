interface ItemInfo {
  anchorId: string;
  anchorCorner: string;
  elem: SVGGraphicsElement;
  elemCorner: string;
  dx: number;
  dy: number;
}

let svgFlowItems: ItemInfo[];

export function updateSvgFlowItems(): void {
  svgFlowItems = [];

  const flowItems = document.querySelectorAll('.svg-flow');

  Array.from(flowItems).forEach(item => {
    const flowSpec = item.getAttributeNS(null, 'svg-flow');
    const corners = /\b([tb][lr])\b(?:.*?\b([tb][lr])\b)?/.exec(flowSpec) ?? [];
    const itemInfo = {
      anchorId: (/^([^,]+)(,|$)/.exec(flowSpec) ?? [])[1],
      anchorCorner: corners[1] ?? 'br',
      elem: item as SVGGraphicsElement,
      elemCorner: corners[2] ?? 'bl',
      dx: Number((/\bdx=(-?[.\d]+)/.exec(flowSpec) ?? [])[1] ?? 0),
      dy: Number((/\bdy=(-?[.\d]+)/.exec(flowSpec) ?? [])[1] ?? 0)
    };

    svgFlowItems.push(itemInfo);
  });
}

interface SimpleRect { x: number, y: number, width: number, height: number }

function getBBox(elem: SVGGraphicsElement): SimpleRect {
  if (elem.localName !== 'tspan')
    return elem.getBBox();

  const text = elem as SVGTextContentElement;
  const extent = text.getNumberOfChars() > 0 ? text.getExtentOfChar(0) : { x: 0, y: 0, height: 0 };
  const width = text.getComputedTextLength();

  return { x: extent.x, y: extent.y, width, height: extent.height };
}

export function reflow(): void {
  svgFlowItems.forEach(item => {
    const anchor = document.querySelector('#' + item.anchorId) as SVGGraphicsElement;

    if (anchor) {
      const r1 = getBBox(anchor);
      const r2 = getBBox(item.elem);
      const labelX = r1.x +
        (item.anchorCorner.charAt(1) === 'r' ? r1.width : 0) -
        (item.elemCorner.charAt(1) === 'r' ? r2.width : 0) + item.dx;
      const labelY = r1.y +
        (item.anchorCorner.charAt(0) === 'b' ? r1.height : 0) -
        (item.elemCorner.charAt(0) === 'b' ? r2.height : 0) + item.dy;

      item.elem.setAttributeNS(null, 'x', labelX.toString());
      item.elem.setAttributeNS(null, 'y', labelY.toString());
    }
  });
}
