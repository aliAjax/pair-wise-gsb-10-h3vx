import React from 'react';
import CommitInput from './CommitInput.jsx';
import { isCrossSubnet, validateDeviceAddress } from '../addressing/validation.js';

// 属性面板：设备属性与地址登记（网段/IP/网关/VLAN），变更经校验后才生效。
export default function Inspector({ node, data, usage, handlers }) {
  if (!node) {
    return (
      <aside className="inspector">
        <div className="section-title"><span>属性</span><small>未选择</small></div>
        <p className="muted inspector-empty">在画布或列表中选择一个设备</p>
      </aside>
    );
  }
  const addr = data.addressing[node.id];
  const subnet = addr ? data.subnets.find((s) => s.id === addr.subnetId) : null;
  const addrIssues = validateDeviceAddress(node.id, addr, data);
  const subnetUsage = subnet ? usage[subnet.id] : null;
  const connections = data.edges.filter((e) => e.a === node.id || e.b === node.id);
  const h = handlers;
  return (
    <aside className="inspector">
      <div className="section-title"><span>属性</span><small>{node.type}</small></div>
      <label>设备名称<CommitInput value={node.name} onCommit={h.onCommitName} /></label>
      <label>
        设备类型
        <select value={node.type} onChange={(e) => h.onCommitType(e.target.value)}>
          <option value="router">路由器</option>
          <option value="switch">交换机</option>
          <option value="server">服务器</option>
          <option value="device">终端设备</option>
        </select>
      </label>
      <div className="section-title addr-head"><span>地址登记</span><small>{subnet ? subnet.name : '未登记'}</small></div>
      <label>
        网段
        <select value={addr?.subnetId || ''} onChange={(e) => h.onCommitSubnet(node.id, e.target.value)}>
          {!addr && <option value="">未登记</option>}
          {data.subnets.map((s) => (
            <option key={s.id} value={s.id}>{s.name}（{s.cidr}）</option>
          ))}
        </select>
      </label>
      <label>IP 地址<CommitInput mono value={addr?.ip || ''} placeholder="如 10.0.1.10" onCommit={h.onCommitIp} /></label>
      {subnetUsage && (
        <p className="hint">网段可用 {subnetUsage.free}/{subnetUsage.total} · 下一个可用 {subnetUsage.next || '—'}</p>
      )}
      <label>网关<CommitInput mono value={addr?.gateway || ''} placeholder="如 10.0.1.1" onCommit={h.onCommitGateway} /></label>
      <label>VLAN<CommitInput mono value={addr?.vlan ?? ''} placeholder="1-4094" onCommit={h.onCommitVlan} /></label>
      {subnet && <p className="hint">所属网段 VLAN：{subnet.vlan}（在网段管理中调整）</p>}
      {addrIssues.length > 0 && (
        <div className="field-issues">
          {addrIssues.map((is, i) => (
            <span key={i}>⚠ {is.message}</span>
          ))}
        </div>
      )}
      <div className="inspector-actions">
        <button onClick={h.onConnect}>⌁ 添加连接</button>
        <button className="danger" onClick={() => h.onRemoveNode(node.id)}>删除设备</button>
      </div>
      <div className="connections">
        <div className="section-title"><span>连接</span><small>{connections.length} 条</small></div>
        {connections.map((e) => {
          const otherId = e.a === node.id ? e.b : e.a;
          const other = data.nodes.find((n) => n.id === otherId);
          const cross = isCrossSubnet(e, data);
          return (
            <div className="connection" key={e.id}>
              <span className={'mini ' + (other?.type || 'device')}></span>
              <div className="conn-body">
                <strong>{other?.name || otherId}</strong>
                {cross ? (
                  <CommitInput mono placeholder="路由标记（跨网段必填）" value={e.route} onCommit={(v) => h.onCommitRoute(e.id, v)} />
                ) : (
                  <small>同网段直连</small>
                )}
              </div>
              <button className="conn-del" title="删除连线" onClick={() => h.onRemoveEdge(e.id)}>✕</button>
            </div>
          );
        })}
        {connections.length === 0 && <p className="muted inspector-empty">暂无连接</p>}
      </div>
    </aside>
  );
}
