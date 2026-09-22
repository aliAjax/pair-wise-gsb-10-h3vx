import React from 'react';
import { DEVICE_TYPES, subnetUsage } from '../addressing.js';

// 左侧：设备库 + 网段规划（可用地址）+ 图中节点
export default function Inventory({
  plan, selected, setSelected, selectedSubnet, setSelectedSubnet,
  onAddNode, onSelectSubnet, validationMap,
}) {
  return (
    <aside className="inventory">
      <div className="section-title">
        <span>设备库</span>
        <small>{plan.nodes.length} 个节点</small>
      </div>
      <div className="device-types">
        {DEVICE_TYPES.map(({ type, icon, label }) => (
          <button key={type} onClick={() => onAddNode(type)} title="添加设备（自动登记网段与空闲 IP）">
            <i className={type}>{icon}</i>
            {label}
            <span>＋</span>
          </button>
        ))}
      </div>

      <div className="section-title nodes-head">
        <span>网段与地址规划</span>
        <small>可用 / 总量</small>
      </div>
      <div className="subnet-list">
        {plan.subnets.map((s) => {
          const usage = subnetUsage(plan, s);
          const pct = usage.count ? Math.round((usage.used / usage.count) * 100) : 0;
          const errs = validationMap.subnet.get(s.id) || [];
          return (
            <button
              key={s.id}
              className={`subnet-card ${selectedSubnet === s.id ? 'sel' : ''} ${errs.length ? 'bad' : ''}`}
              onClick={() => onSelectSubnet(s.id)}
              title={errs.map((e) => e.message).join('\n')}
            >
              <div className="subnet-row">
                <strong>{s.name}</strong>
                <small>VLAN {s.vlan || '—'}</small>
              </div>
              <div className="subnet-row mono">
                <span>{s.cidr}</span>
                <b className={usage.free === 0 ? 'zero' : ''}>{usage.free}/{usage.count}</b>
              </div>
              <div className="usage-bar"><i style={{ width: `${pct}%` }} /></div>
              <div className="subnet-row gateway">
                <small>网关 {s.gateway || '—'}</small>
                {errs.length > 0 && <em>⚠ {errs.length}</em>}
              </div>
            </button>
          );
        })}
        {plan.subnets.length === 0 && <p className="empty-hint">还没有网段，先在工具条添加网段</p>}
      </div>

      <div className="section-title nodes-head">
        <span>图中节点</span>
        <small>点击查看</small>
      </div>
      <div className="node-list">
        {plan.nodes.map((n) => {
          const meta = DEVICE_TYPES.find((d) => d.type === n.type) || DEVICE_TYPES[3];
          const errs = validationMap.node.get(n.id) || [];
          return (
            <button key={n.id} className={selected === n.id ? 'sel' : ''} onClick={() => setSelected(n.id)}>
              <i className={n.type}>{meta.icon}</i>
              <span>
                <strong>{n.name}{errs.length > 0 && <em className="badge-err">⚠</em>}</strong>
                <small>{n.ip || '未配置 IP'}</small>
              </span>
              <b>›</b>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
