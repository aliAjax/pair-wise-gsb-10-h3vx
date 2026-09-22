import React from 'react';

// 顶部与工具条
export default function Toolbar({ tool, setTool, onAddSubnet, onCheck, onExport, onSave, stats, savedAt }) {
  return (
    <>
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div>
            <strong>NETSCAPE</strong>
            <small>ADDRESS PLANNING DESK</small>
          </div>
        </div>
        <div className="file">
          <span className={`dot ${stats.errors ? 'dot-err' : stats.warnings ? 'dot-warn' : ''}`}></span>
          <div>
            <strong>office-network.json</strong>
            <small>{stats.errors ? `${stats.errors} 个错误待处理` : stats.warnings ? `${stats.warnings} 个提示` : `最近保存：${savedAt}`}</small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={onCheck}>✓ 校验</button>
          <button onClick={onExport}>↓ 导出</button>
          <button className="save" onClick={onSave}>保存更改</button>
        </div>
      </header>
      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>↖ 选择</button>
          <button className={tool === 'connect' ? 'on' : ''} onClick={() => setTool(tool === 'connect' ? 'select' : 'connect')}>
            ⌁ {tool === 'connect' ? '取消连线' : '连线'}
          </button>
          <button onClick={onAddSubnet}>▤ 网段</button>
        </div>
        <div className="tool-group zoom">
          <span>
            {stats.subnets} 网段 · {stats.nodes} 设备 · {stats.edges} 连线 · {stats.freeIps} 可用地址
          </span>
        </div>
      </div>
    </>
  );
}
