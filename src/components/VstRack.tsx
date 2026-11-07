import { SectionHeading } from "./SectionHeading";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Ban, Blocks, ChevronDown, Eye, EyeOff, ExternalLink, FolderPlus, Power, RefreshCw, RotateCcw, Search, ShieldAlert, SkipForward, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";
import { useVstPluginSearch } from "../hooks/useVstPluginSearch";
import { useVstRackStore } from "../stores/vstRackStore";

const PLUGIN_PAGE_SIZE = 20;

const directoryStateKey: Record<PluginDirectoryState, string> = {
  "not-scanned": "vst.stateNotScanned",
  ready: "vst.stateReady",
  missing: "vst.stateMissing",
  "access-denied": "vst.stateAccessDenied",
  "no-candidate-modules": "vst.stateNoModules",
  "no-accepted-plugins": "vst.stateNoPlugins",
  "scanner-error": "vst.stateScannerError"
};

export function VstRack() {
  const { t } = useI18n();
  const vst = useVstRackStore();
  const [query, setQuery] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [showScanSources, setShowScanSources] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PLUGIN_PAGE_SIZE);
  const pluginListRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void vst.initialize(); }, []);

  const filtered = useVstPluginSearch(vst.plugins, query, showUnavailable);

  useLayoutEffect(() => {
    setVisibleCount(PLUGIN_PAGE_SIZE);
    if (pluginListRef.current) pluginListRef.current.scrollTop = 0;
  }, [filtered]);

  return <div className="vst-workspace">
    <div className={`vst-engine-status ${vst.runtimeReady ? "online" : "offline"}`}>
      <Blocks />
      <div><b>{vst.performanceSuspended ? "VST SUSPENDED · ECO MODE" : vst.runtimeReady ? "PLUGIN CHAIN LOADED" : vst.nativeEnabled ? "PLUGIN ENGINE STARTING" : "DRY PATH · VST OFF"}</b><span>{vst.error || vst.engine.detail}</span></div>
      <button disabled={vst.performanceSuspended} className={vst.nativeEnabled ? "active" : ""} onClick={() => void vst.toggleNativeEngine()}>{vst.performanceSuspended ? "ECO LOCKED" : vst.nativeEnabled ? t("vst.disableProcessing") : t("vst.enableProcessing")}</button>
      <em>{vst.runtimeReady ? `${vst.rack.filter(item => item.enabled).length} PLUGINS ACTIVE` : vst.engine.backend}</em>
    </div>

    <section className="vst-browser workspace-section panel">
      <header>
        <div><SectionHeading icon={Blocks}>{t("vst.installed")}</SectionHeading></div>
        <div className="vst-tools">
          <button className={showUnavailable ? "active" : ""} title={t(showUnavailable ? "vst.hideUnavailable" : "vst.showUnavailable")} onClick={() => setShowUnavailable(value => !value)}>{showUnavailable ? <EyeOff /> : <Eye />}</button>
          <button title={t("vst.addFolder")} onClick={() => void vst.addFolder()}><FolderPlus /></button>
          <button title={t("vst.rescan")} onClick={() => void vst.scan()} disabled={vst.scanning}><RefreshCw className={vst.scanning ? "spin" : ""} /></button>
        </div>
      </header>
      <div className="vst-scan-summary" title={vst.scanSession ? `SESSION ${vst.scanSession.id}` : t("vst.waitingSession")}>
        <span><small>FOUND</small><b>{vst.scanSession?.pluginDescriptorsDiscovered ?? 0}</b></span>
        <span><small>AVAILABLE</small><b>{vst.scanSession?.acceptedPlugins ?? 0}</b></span>
        <span><small>FILTERED BY POLICY</small><b>{vst.scanSession?.policyRejectedPlugins ?? 0}</b></span>
        <span className={vst.scanSession?.failedModules ? "failed" : ""}><small>SCAN FAILED</small><b>{vst.scanSession?.failedModules ?? 0}</b></span>
        <div className="vst-scan-meta">
          <label className="vst-search vst-search-inline" title={`${vst.scanSession?.moduleCacheHits ?? 0} MODULE / ${vst.scanSession?.pluginCacheHits ?? 0} PLUGIN CACHE HITS · ${vst.scanSession?.durationMs ?? 0} ms`}><Search /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t("vst.search")} placeholder={t("vst.search")} />{query && <b>{filtered.length} / {vst.plugins.length}</b>}</label>
          <div className={`vst-directory-menu ${showScanSources ? "open" : ""}`}>
            <button className="vst-directory-menu-trigger" aria-expanded={showScanSources} onClick={() => setShowScanSources(value => !value)}>
              <FolderPlus /><span><b>{t("vst.locations")}</b><small>{vst.directories.filter(directory => directory.enabled).length}/{vst.directories.length}</small></span><ChevronDown />
            </button>
            {showScanSources && <div className="vst-directory-list">
              {vst.directories.map(directory => <div className={`vst-directory ${directory.enabled ? "enabled" : "disabled"} ${directory.state}`} key={directory.id} title={directory.message || directory.path}>
                <button className="vst-directory-toggle" title={t(directory.enabled ? "vst.disableDirectory" : "vst.enableDirectory")} onClick={() => void vst.setFolderEnabled(directory.id, !directory.enabled)}><Power /></button>
                <span><b>{directory.path}</b><small>{directory.source === "standard" ? "STANDARD" : "CUSTOM"} · {t(directoryStateKey[directory.state])} · {directory.candidateModuleCount} MODULES / {directory.acceptedPluginCount} SAFE</small></span>
                {directory.source === "user" && <button className="vst-directory-remove" title={t("vst.removeDirectory")} onClick={() => void vst.removeFolder(directory.id)}><Trash2 /></button>}
              </div>)}
            </div>}
          </div>
        </div>
      </div>
      <div className="vst-quarantine-list">
        {vst.quarantines.map(item => <div className={item.userDisabled ? "user-disabled" : item.quarantined ? "quarantined" : "failed"} key={item.normalizedPath} title={item.modulePath}>
          <ShieldAlert /><span><b>{item.modulePath}</b><small>{item.lastFailureCode} / {item.lastFailureStage} · {item.failureCount} FAILURES · {item.userDisabled ? "DISABLED BY USER" : item.quarantined ? "QUARANTINED" : "AUTO-SKIP ON STARTUP"}</small></span>
          <button title={t(item.userDisabled ? "vst.enableModule" : item.quarantined ? "vst.clearQuarantine" : "vst.retryModule")} disabled={vst.scanning} onClick={() => void vst.retryQuarantined(item.normalizedPath)}><RotateCcw /></button>
        </div>)}
      </div>
      <div className="vst-plugin-list" ref={pluginListRef} onScroll={event => {
        const list = event.currentTarget;
        if (visibleCount < filtered.length && list.scrollHeight - list.scrollTop - list.clientHeight < 160) {
          setVisibleCount(Math.min(filtered.length, visibleCount + PLUGIN_PAGE_SIZE));
        }
      }}>
        {filtered.slice(0, visibleCount).map(plugin => <button className={plugin.loadable ? "loadable" : "unsupported"} title={plugin.error || `${plugin.manufacturer || t("vst.unknownVendor")} · ${plugin.category || t("vst.uncategorized")}`} key={plugin.id} onDoubleClick={() => vst.addToRack(plugin)}>
          <Blocks /><div><b>{plugin.name}</b><small>{plugin.loadable ? [plugin.manufacturer, plugin.category, plugin.version].filter(Boolean).join(" · ") : plugin.error || plugin.catalogState}</small><span>{plugin.path}</span></div><em>{plugin.format}{plugin.loadable ? "" : " · BLOCKED"}</em>
        </button>)}
        {!vst.scanning && !filtered.length && <div className="vst-empty">{t("vst.none")}</div>}
      </div>
      {vst.scanning && <div className="vst-scan-progress">
        <div><span>{vst.scanProgress.phase === "discovering" ? t("vst.discovering") : vst.scanProgress.phase === "cache" ? t("vst.readingCache") : t("vst.nativeValidation")}</span><b>{vst.scanProgress.total ? `${vst.scanProgress.completed} / ${vst.scanProgress.total}` : "—"}</b></div>
        <progress max={Math.max(1, vst.scanProgress.total)} value={vst.scanProgress.completed} />
        <div className="vst-scan-current">
          <small title={vst.scanProgress.current}>{vst.scanProgress.current}</small>
          {vst.scanProgress.phase === "scanning" && <span className="vst-scan-actions">
            <button disabled={!vst.scanProgress.normalizedPath} title={t("vst.skipCurrent")} onClick={() => void vst.controlScan("skip")}><SkipForward />{t("vst.skip")}</button>
            <button disabled={!vst.scanProgress.normalizedPath} title={t("vst.disableCurrent")} onClick={() => void vst.controlScan("disable")}><Ban />{t("vst.disable")}</button>
          </span>}
        </div>
      </div>}
      <footer><span>{vst.scanning ? "SCANNING PLUGIN DATABASE" : `${filtered.length} ASTRELIS-COMPATIBLE PLUGINS`}</span><small>{t(showUnavailable ? "vst.diagnosticOnly" : "vst.addHint")}</small></footer>
    </section>

    <section className="vst-chain workspace-section panel">
      <header><div><SectionHeading icon={Blocks}>{t("vst.rack")}</SectionHeading></div><b>{vst.rack.length} SLOTS</b></header>
      {!vst.nativeEnabled && <div className="vst-warning">{t("vst.configOnlyWarning")}</div>}
      <div className="vst-rack-list">
        {vst.rack.map((item, index) => <div className={`vst-slot ${item.enabled ? "enabled" : "bypassed"}`} key={item.id}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <button className="vst-power" title={t(item.enabled ? "common.bypass" : "common.enable")} onClick={() => vst.toggleRackItem(item.id)}><Power /></button>
          <div><b>{item.name}</b><small>{item.enabled ? vst.nativeEnabled ? "ENABLED · NATIVE CHAIN" : "ENABLED · WAITING FOR HOST" : "BYPASSED"}</small></div>
          <button title={t("vst.openEditor")} onClick={() => void vst.openEditor(item)}><ExternalLink /></button>
          <button title={t("common.moveUp")} onClick={() => vst.moveRackItem(index, -1)} disabled={index === 0}><ArrowUp /></button>
          <button title={t("common.moveDown")} onClick={() => vst.moveRackItem(index, 1)} disabled={index === vst.rack.length - 1}><ArrowDown /></button>
          <button title={t("common.remove")} onClick={() => void vst.removeFromRack(item.id)}><Trash2 /></button>
        </div>)}
        {!vst.rack.length && <div className="vst-empty">{t("vst.emptyRack")}</div>}
      </div>
      {vst.error && <p className="error-text dismissible"><span>{vst.error}</span><button title={t("common.close")} onClick={vst.clearError}>×</button></p>}
    </section>
  </div>;
}
