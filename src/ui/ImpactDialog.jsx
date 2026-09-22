import React, { useState } from 'react';

// 受影响设备与连线的列表（含跨网段连线的路由标记填写），网段对话框复用。
export function ImpactSections({ impact, routes, onRoute }) {
  return (
    <>
      <div className="impact-cols">
        <div>
          <h4>受影响设备（{impact.devices.length}）</h4>
          {impact.devices.length === 0 && <p className="muted">无受影响设备</p>}
          {impact.devices.map((d) => (
            <div className="impact-item" key={d.id}>
              <strong>{d.name}</strong>
              {d.note && <small>{d.note}</small>}
              {(d.problems || []).map((p) => (
                <small className="bad" key={p}>⚠ {p}</small>
              ))}
            </div>
          ))}
        </div>
        <div>
          <h4>受影响连线（{impact.links.length}）</h4>
          {impact.links.length === 0 && <p className="muted">无受影响连线</p>}
          {impact.links.map((l) => (
            <div className="impact-item" key={l.id}>
              <strong>{l.label}</strong>
              <small>{l.note}</small>
              {l.needsRoute && (
                <input
                  className="mono"
                  placeholder="路由标记，如 via 10.0.0.1"
                  value={routes[l.id] ?? l.route ?? ''}
                  onChange={(e) => onRoute(l.id, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {impact.blockers.length > 0 && (
        <div className="blockers">
          <h4>无法应用，请先解决</h4>
          {impact.blockers.map((b, i) => (
            <p key={i}>⚠ {b}</p>
          ))}
        </div>
      )}
    </>
  );
}

// 所有需要路由标记的连线是否都已填写。
export function routesComplete(impact, routes) {
  return !impact.links.some((l) => l.needsRoute && !String(routes[l.id] ?? l.route ?? '').trim());
}

export function collectRoutes(impact, routes) {
  const out = {};
  for (const l of impact.links) {
    if (l.needsRoute) out[l.id] = String(routes[l.id] ?? l.route ?? '').trim();
  }
  return out;
}

// 通用影响确认对话框：确认前展示受影响设备与连线；存在阻断项或路由未标时禁止确认。
export default function ImpactDialog({ title, intro, impact, confirmLabel = '确认应用', onConfirm, onCancel }) {
  const [routes, setRoutes] = useState({});
  const missingRoute = !routesComplete(impact, routes);
  const blocked = impact.blockers.length > 0 || missingRoute;
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {intro && <p className="dialog-intro">{intro}</p>}
        <ImpactSections impact={impact} routes={routes} onRoute={(id, v) => setRoutes((r) => ({ ...r, [id]: v }))} />
        {impact.blockers.length === 0 && missingRoute && (
          <p className="warn">存在跨网段连线未标明路由，填写路由标记后才能应用。</p>
        )}
        <div className="dialog-actions">
          <button onClick={onCancel}>取消</button>
          <button className="save" disabled={blocked} onClick={() => onConfirm(collectRoutes(impact, routes))}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
