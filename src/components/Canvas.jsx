import React, { useRef } from 'react';
import { DEVICE_TYPES, findNode, findSubnet, sameSubnet } from '../addressing.js';

// 中央画布：节点拖拽、连线渲染与点击标记路由
export default function Canvas({
  plan, selected, setSelected, dragRef, onMoveNode, connectTool, onCanvasNodeClick, edgeErrors,
}) {
  const board = useRef();

  const move = (e) => {
    if (!dragRef.current) return;
    const r = board.current.getBoundingClientRect();
    onMoveNode(dragRef.current, Math.max(35, e.clientX - r.left), Math.max(35, e.clientY - r.top));
  };

  return (
    <section className="canvas-wrap">
      <div
        className={`canvas ${connectTool ? 'connect-mode' : ''}`}
        ref={board}
        onMouseMove={move}
        onMouseUp={() => { dragRef.current = null; }}
        onMouseLeave={() => { dragRef.current = null; }}
      >
        {plan.edges.map((e) => {
          const n1 = findNode(plan, e.a);
          const n2 = findNode(plan, e.b);
          if (!n1 || !n2) return null;
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const len = Math.hypot(dx, dy);
          const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
          const cross = sameSubnet(plan, e.a, e.b) === false;
          const bad = edgeErrors.has(e.id);
          const cls = `edge ${cross ? 'cross' : 'local'} ${e.routed ? 'routed' : ''} ${bad ? 'bad' : ''}`;
          return (
            <div
              key={e.id}
              className={cls}
              style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
              onClick={(ev) => { ev.stopPropagation(); onCanvasNodeClick({ kind: 'edge', id: e.id }); }}
              title={
                bad
                  ? '跨网段连线未标明路由，点击检查'
                  : cross
                    ? `跨网段连线${e.routed ? '（已标明路由，点击取消）' : '（点击标明路由）'}`
                    : '同网段连线'
              }
            >
              <span className="edge-line" />
              {cross && <b className="edge-tag">{e.routed ? 'R' : '?'}</b>}
            </div>
          );
        })}

        {plan.nodes.map((n) => {
          const meta = DEVICE_TYPES.find((d) => d.type === n.type) || DEVICE_TYPES[3];
          const subnet = findSubnet(plan, n.subnetId);
          return (
            <button
              key={n.id}
              className={`node ${n.type} ${selected === n.id ? 'picked' : ''}`}
              style={{ left: n.x - 42, top: n.y - 31 }}
              onMouseDown={(e) => {
                if (connectTool) return;
                e.stopPropagation();
                setSelected(n.id);
                dragRef.current = n.id;
              }}
              onClick={() => onCanvasNodeClick({ kind: 'node', id: n.id })}
            >
              <i>{meta.icon}</i>
              <strong>{n.name}</strong>
              <small>{n.ip || '未配置'}</small>
              {subnet && <em className="node-vlan" style={{ background: vlanColor(subnet.vlan) }}>V{subnet.vlan}</em>}
            </button>
          );
        })}

        {connectTool && <div className="connect-hint">连线模式：点击目标设备完成连接（再点「连线」退出）</div>}

        <div className="legend">
          <span><i className="lg-local" />同网段</span>
          <span><i className="lg-cross" />跨网段</span>
          <span><i className="lg-routed" />已标路由</span>
          <span><i className="lg-bad" />缺路由</span>
        </div>
      </div>
      <div className="canvas-footer">
        <span>拖动节点调整位置 · {plan.edges.length} 条连接{connectTool ? ' · 连线模式中' : ''}</span>
        <span>坐标系：画布局部</span>
      </div>
    </section>
  );
}

// VLAN 标签底色（同一 VLAN 颜色一致）
const PALETTE = ['#d9e9df', '#f2ddb6', '#d9e3ee', '#e9dded', '#dfe9d8', '#eed9d9', '#d9ece9', '#e6d9ee'];
export function vlanColor(vlan) {
  const n = Number(vlan);
  if (!Number.isInteger(n)) return '#e3e8e2';
  return PALETTE[n % PALETTE.length];
}
