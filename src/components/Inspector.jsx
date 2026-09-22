import React from 'react';
import NodeInspector from './NodeInspector.jsx';
import SubnetPanel from './SubnetPanel.jsx';

// 右侧检查器：在设备属性与网段属性之间切换
export default function Inspector(props) {
  const { inspectSubnet, subnet, node } = props;
  return (
    <aside className="inspector">
      <div className="section-title">
        <span>{inspectSubnet ? '网段规划' : '设备属性'}</span>
        <small>{inspectSubnet ? subnet?.cidr : node?.type}</small>
      </div>
      {inspectSubnet
        ? (subnet ? <SubnetPanel {...props} /> : <p className="empty-hint">网段不存在</p>)
        : <NodeInspector {...props} />}
    </aside>
  );
}
