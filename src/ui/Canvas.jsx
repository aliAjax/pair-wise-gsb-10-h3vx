import React from 'react';
import { isCrossSubnet } from '../addressing/validation.js';

export const ICONS = { router: '◉', switch: '▦', server: '▣', device: '▱' };

// 画布：节点与连线的可视化；跨网段连线橙色标示并展示路由标记。
export default function Canvas({ data, selected, onSelect, onDragStart, onDragEnd, onMove, board }) {
  return (
    <section className="canvas-wrap">
      <div className="canvas" ref={board} onMouseMove={onMove} onMouseUp={onDragEnd}>
        {data.edges.map((e) => {
          const n1 = data.nodes.find((n) => n.id === e.a);
          const n2 = data.nodes.find((n) => n.id === e.b);
          if (!n1 || !n2) return null;
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const len = Math.hypot(dx, dy);
          const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
          const cross = isCrossSubnet(e, data);
          const bad = cross && !String(e.route || '').trim();
          return (
            <React.Fragment key={e.id}>
              <div
                className={'edge' + (cross ? ' cross' : '') + (bad ? ' bad' : '')}
                style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
              >
                <span></span>
              </div>
              {e.route ? (
                <div className="edge-label" style={{ left: (n1.x + n2.x) / 2, top: (n1.y + n2.y) / 2 }}>
                  {e.route}
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
        {data.nodes.map((n) => (
          <button
            key={n.id}
            className={'node ' + n.type + (selected === n.id ? ' picked' : '')}
            style={{ left: n.x - 42, top: n.y - 31 }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onSelect(n.id);
              onDragStart(n.id);
            }}
            onClick={() => onSelect(n.id)}
          >
            <i>{ICONS[n.type] || '▱'}</i>
            <strong>{n.name}</strong>
            <small>{data.addressing[n.id]?.ip || '未登记'}</small>
          </button>
        ))}
        <div className="legend">
          <span><i className="router"></i>路由器</span>
          <span><i className="switch"></i>交换机</span>
          <span><i className="server"></i>服务器</span>
        </div>
      </div>
      <div className="canvas-footer">
        <span>拖动节点调整位置 · {data.edges.length} 条连接</span>
        <span>橙色为跨网段连线，需标明路由</span>
      </div>
    </section>
  );
}
