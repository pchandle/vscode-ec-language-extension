import React, { useMemo, useState } from "react";
import { buildPreview, PddDefinition, PdesDesign } from "./transform";

type TopicRole = "host" | "join";
type TopicConstraint = "requirement" | "obligation";
type TopicType = "abstraction" | "integer" | "string" | "boolean";

interface PddTopic {
  name: string;
  role: TopicRole;
  constraint: TopicConstraint;
  type: TopicType;
}

interface PddModeTemplate {
  name: string;
  topics: PddTopic[];
}

interface TopicInstance {
  name: string;
  properties: Record<string, any>;
}

interface ModeInstance {
  modeTemplate: string;
  collaborationLabel?: string;
  topics: TopicInstance[];
}

type Props = {
  value: PdesDesign | null;
  pdd: PddDefinition | null;
  pddPath?: string;
  parseError?: string;
  hostErrors?: string[];
  onChange: (next: PdesDesign) => void;
};

const propertyFields: Record<
  TopicType,
  { key: string; label: string; type: "text" | "number" }[]
> = {
  abstraction: [{ key: "protocol", label: "Protocol", type: "text" }],
  integer: [
    { key: "minimum", label: "Minimum", type: "number" },
    { key: "maximum", label: "Maximum", type: "number" },
    { key: "hint", label: "Hint", type: "text" },
  ],
  string: [
    { key: "length", label: "Length", type: "number" },
    { key: "hint", label: "Hint", type: "text" },
  ],
  boolean: [],
};

export function PdesEditor({ value, pdd, pddPath, parseError, hostErrors, onChange }: Props) {
  const design = value
    ? {
        ...value,
        classification: (value as any).classification ?? (value as any).name ?? "",
      }
    : {
        protocolDesignVersion: pdd?.protocolDesignVersion ?? 1,
        classification: "",
        description: "",
        policy: "",
        modes: [],
      };
  const [newModeTemplate, setNewModeTemplate] = useState<string>("");
  const [collapsedModes, setCollapsedModes] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    (design.modes ?? []).forEach((_, idx) => {
      initial[idx] = true;
    });
    return initial;
  });

  const templates = useMemo(() => {
    if (!pdd) {
      return {};
    }
    const map: Record<string, PddModeTemplate> = {};
    for (const t of pdd.modeTemplates ?? []) {
      if (t?.name) {
        map[t.name] = t;
      }
    }
    return map;
  }, [pdd]);

  const updateDesign = (partial: Partial<PdesDesign>) => {
    onChange({ ...design, ...partial });
  };

  const updateModeTopic = (modeIndex: number, topicIndex: number, next: TopicInstance) => {
    const modes = [...(design.modes ?? [])];
    const mode = { ...(modes[modeIndex] ?? { modeTemplate: "", topics: [] }) };
    const topics = [...(mode.topics ?? [])];
    topics[topicIndex] = next;
    mode.topics = topics;
    modes[modeIndex] = mode;
    updateDesign({ modes });
  };

  const updateMode = (modeIndex: number, partial: Partial<ModeInstance>) => {
    const modes = [...(design.modes ?? [])];
    const mode = { ...(modes[modeIndex] ?? { modeTemplate: "", topics: [] }) };
    modes[modeIndex] = { ...mode, ...partial };
    updateDesign({ modes });
  };

  const addMode = () => {
    if (!newModeTemplate || !templates[newModeTemplate]) {
      return;
    }
    const template = templates[newModeTemplate];
    const topics = (template.topics || []).map<TopicInstance>((t) => ({
      name: t.name || "",
      properties: {},
    }));
    const modes = [...(design.modes ?? []), { modeTemplate: template.name, collaborationLabel: "", topics }];
    updateDesign({ modes });
    setCollapsedModes((prev) => ({ ...prev, [modes.length - 1]: false }));
  };

  const moveMode = (index: number, delta: number) => {
    const modes = [...(design.modes ?? [])];
    const target = index + delta;
    if (target < 0 || target >= modes.length) return;
    const [item] = modes.splice(index, 1);
    modes.splice(target, 0, item);
    updateDesign({ modes });
    setCollapsedModes((prev) => {
      const next = { ...prev };
      const current = next[index];
      next[index] = next[target];
      next[target] = current;
      return next;
    });
  };

  const removeMode = (index: number) => {
    const modes = [...(design.modes ?? [])];
    modes.splice(index, 1);
    updateDesign({ modes });
    setCollapsedModes((prev) => {
      const next = { ...prev };
      delete next[index];
      // shift keys above removed index down by 1
      const reordered: Record<number, boolean> = {};
      Object.entries(next).forEach(([k, v]) => {
        const num = Number(k);
        reordered[num > index ? num - 1 : num] = v;
      });
      return reordered;
    });
  };

  const toggleMode = (index: number) => {
    setCollapsedModes((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const setAllModesCollapsed = (collapsed: boolean) => {
    const next: Record<number, boolean> = {};
    (design.modes ?? []).forEach((_, idx) => {
      next[idx] = collapsed;
    });
    setCollapsedModes(next);
  };

  const renderHeader = () => (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Protocol Design</h2>
        <div style={styles.meta}>
          <span>Version: {design.protocolDesignVersion}</span>
          {pddPath ? <span style={styles.metaMuted}>PDD: {pddPath}</span> : null}
        </div>
      </div>
      <div style={styles.fieldGrid}>
        <label style={styles.label}>Classification</label>
        <input
          style={styles.input}
          value={design.classification ?? ""}
          onChange={(e) => updateDesign({ classification: e.target.value })}
        />
        <label style={styles.label}>Description</label>
        <textarea
          style={{ ...styles.input, minHeight: 60 }}
          value={design.description ?? ""}
          onChange={(e) => updateDesign({ description: e.target.value })}
        />
        <label style={styles.label}>Policy</label>
        <input
          style={styles.input}
          value={design.policy ?? ""}
          onChange={(e) => updateDesign({ policy: e.target.value })}
        />
      </div>
    </section>
  );

  const renderTopic = (topic: TopicInstance, template: PddTopic | undefined, modeIndex: number, topicIndex: number) => {
    const type = template?.type ?? "abstraction";
    const fields = propertyFields[type] ?? [];
    return (
      <div key={topicIndex} style={styles.topicCard}>
        <div style={styles.topicHeader}>
          <div style={styles.topicTitle}>
            <div style={styles.badge}>{template?.role ?? "?"}</div>
            <div style={styles.badge}>{template?.constraint ?? "?"}</div>
            <div style={styles.badge}>{template?.type ?? "?"}</div>
            <input
              style={styles.topicName}
              value={topic.name ?? ""}
              onChange={(e) => updateModeTopic(modeIndex, topicIndex, { ...topic, name: e.target.value })}
            />
          </div>
          <div style={styles.topicMeta}>{template?.name ?? "Topic"}</div>
        </div>
        <div style={styles.topicBody}>
          {fields.length === 0 ? <div style={styles.metaMuted}>No properties</div> : null}
          {fields.map((field) => (
            <label key={field.key} style={styles.propertyRow}>
              <span style={styles.label}>{field.label}</span>
              <input
                style={styles.input}
                type={field.type === "number" ? "number" : "text"}
                value={topic.properties?.[field.key] ?? ""}
                onChange={(e) =>
                  updateModeTopic(modeIndex, topicIndex, {
                    ...topic,
                    properties: {
                      ...(topic.properties ?? {}),
                      [field.key]:
                        field.type === "number"
                          ? e.target.value === ""
                            ? undefined
                            : Number(e.target.value)
                          : e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>
    );
  };

  const renderMode = (mode: ModeInstance, index: number) => {
    const template = templates[mode.modeTemplate];
    const templateTopics = template?.topics ?? [];
    const isCollapsed = collapsedModes[index] ?? false;
    const isFirst = index === 0;
    const isLast = index >= (design.modes?.length ?? 0) - 1;
    return (
      <div key={index} style={styles.modeCard}>
        <div style={styles.modeHeader}>
          <div style={styles.modeTitle}>
            <div style={styles.badge}>Mode</div>
            <input
              style={styles.modeLabelInput}
              value={mode.collaborationLabel ?? ""}
              placeholder="Collaboration label"
              onChange={(e) => updateMode(index, { collaborationLabel: e.target.value })}
            />
            <strong>{mode.modeTemplate}</strong>
          </div>
          {!template ? <span style={styles.metaMuted}>Template not found</span> : null}
          <div style={styles.modeActions}>
            <button style={styles.iconButton} onClick={() => toggleMode(index)} title={isCollapsed ? "Expand" : "Collapse"}>
              {isCollapsed ? "▸" : "▾"}
            </button>
            {!isFirst ? (
              <button style={styles.iconButton} onClick={() => moveMode(index, -1)} title="Move up">
                ↑
              </button>
            ) : (
              <span style={styles.iconPlaceholder} />
            )}
            {!isLast ? (
              <button style={styles.iconButton} onClick={() => moveMode(index, 1)} title="Move down">
                ↓
              </button>
            ) : (
              <span style={styles.iconPlaceholder} />
            )}
            <button style={styles.dangerButton} onClick={() => removeMode(index)} title="Delete mode">
              🗑️
            </button>
          </div>
        </div>
        {!isCollapsed ? (
          <div style={styles.topicList}>
            {mode.topics?.map((topic, tIdx) => renderTopic(topic, templateTopics[tIdx], index, tIdx))}
          </div>
        ) : null}
      </div>
    );
  };

  const preview = useMemo(() => buildPreview(design as any, pdd as any), [design, pdd]);

  return (
    <div style={styles.wrapper}>
      {renderHeader()}
      {parseError ? <div style={styles.bannerError}>Parse error: {parseError}</div> : null}
      {hostErrors && hostErrors.length ? (
        <div style={styles.bannerWarning}>
          <strong>Validation:</strong>
          <ul>
            {hostErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Modes</h2>
          {!pdd ? <span style={styles.metaMuted}>No .pdd loaded</span> : null}
          <div style={styles.modeHeaderActions}>
            <button style={styles.iconButton} onClick={() => setAllModesCollapsed(false)}>Expand all</button>
            <button style={styles.iconButton} onClick={() => setAllModesCollapsed(true)}>Collapse all</button>
          </div>
          {pdd ? (
            <div style={styles.addModeRow}>
              <select
                style={styles.select}
                value={newModeTemplate}
                onChange={(e) => setNewModeTemplate(e.target.value)}
              >
                <option value="">Select template…</option>
                {pdd.modeTemplates?.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button style={styles.addButton} onClick={addMode} disabled={!newModeTemplate}>
                + Add mode
              </button>
            </div>
          ) : null}
        </div>
        <div style={styles.modeList}>
          {design.modes?.length ? design.modes.map((m, idx) => renderMode(m, idx)) : (
            <div style={styles.bannerInfo}>No modes defined.</div>
          )}
        </div>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Macro preview</h2>
          {preview.errors.length ? <span style={styles.metaMuted}>Fix template issues to preview</span> : null}
        </div>
        {preview.errors.length ? (
          <div style={styles.bannerWarning}>
            <ul>
              {preview.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div style={styles.macroGrid}>
          <div style={styles.macroBlock}>
            <div style={styles.macroTitle}>Host macro</div>
            <textarea style={styles.codeArea} readOnly value={preview.hostMacro} />
          </div>
          <div style={styles.macroBlock}>
            <div style={styles.macroTitle}>Join macro</div>
            <textarea style={styles.codeArea} readOnly value={preview.joinMacro} />
          </div>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "grid",
    gap: 12,
    color: "var(--vscode-editor-foreground)",
    paddingTop: 6,
  },
  section: {
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: 8,
    padding: 12,
    background: "var(--vscode-editor-background)",
    marginTop: 4,
    width: "100%",
    boxSizing: "border-box",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    margin: 0,
  },
  meta: {
    display: "flex",
    gap: 12,
    fontSize: 12,
  },
  metaMuted: {
    color: "var(--vscode-descriptionForeground)",
    fontSize: 12,
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "140px minmax(0, 1fr)",
    gap: "8px 10px",
    alignItems: "center",
  },
  label: {
    fontWeight: 500,
  },
  input: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid var(--vscode-input-border)",
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
  },
  modeList: {
    display: "grid",
    gap: 10,
  },
  modeCard: {
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: 8,
    padding: 10,
    background: "var(--vscode-editor-background)",
  },
  modeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modeTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
  },
  modeLabelInput: {
    border: "1px solid var(--vscode-input-border)",
    borderRadius: 6,
    padding: "4px 6px",
    minWidth: 160,
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
  },
  topicList: {
    display: "grid",
    gap: 8,
  },
  modeActions: {
    display: "flex",
    gap: 6,
  },
  modeHeaderActions: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  iconButton: {
    border: "1px solid var(--vscode-input-border)",
    background: "var(--vscode-button-secondaryBackground)",
    color: "var(--vscode-button-secondaryForeground)",
    borderRadius: 6,
    padding: "2px 6px",
    cursor: "pointer",
  },
  iconPlaceholder: {
    display: "inline-block",
    width: 26,
  },
  dangerButton: {
    border: "1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground))",
    background: "transparent",
    color: "var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground))",
    borderRadius: 6,
    padding: "2px 8px",
    cursor: "pointer",
    marginLeft: 6,
  },
  topicCard: {
    border: "1px solid var(--vscode-input-border)",
    borderRadius: 6,
    padding: 8,
    background: "var(--vscode-editor-background)",
  },
  topicHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
    gap: 8,
  },
  topicTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  badge: {
    background: "var(--vscode-button-secondaryBackground, #333)",
    color: "var(--vscode-button-secondaryForeground, #fff)",
    borderRadius: 10,
    padding: "2px 8px",
    fontSize: 12,
    textTransform: "capitalize",
  },
  topicName: {
    border: "1px solid var(--vscode-input-border)",
    borderRadius: 6,
    padding: "4px 6px",
    minWidth: 160,
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
  },
  topicMeta: {
    color: "var(--vscode-descriptionForeground)",
    fontSize: 12,
  },
  topicBody: {
    display: "grid",
    gap: 6,
  },
  propertyRow: {
    display: "grid",
    gridTemplateColumns: "120px minmax(0, 1fr)",
    gap: 8,
    alignItems: "center",
  },
  bannerError: {
    background: "var(--vscode-inputValidation-errorBackground)",
    color: "var(--vscode-inputValidation-errorForeground)",
    border: "1px solid var(--vscode-inputValidation-errorBorder)",
    padding: 10,
    borderRadius: 6,
  },
  bannerWarning: {
    background: "var(--vscode-inputValidation-warningBackground)",
    color: "var(--vscode-inputValidation-warningForeground)",
    border: "1px solid var(--vscode-inputValidation-warningBorder)",
    padding: 10,
    borderRadius: 6,
  },
  bannerInfo: {
    background: "var(--vscode-inputValidation-infoBackground)",
    color: "var(--vscode-inputValidation-infoForeground)",
    border: "1px solid var(--vscode-inputValidation-infoBorder)",
    padding: 10,
    borderRadius: 6,
  },
  addModeRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  select: {
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid var(--vscode-input-border)",
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
  },
  addButton: {
    border: "1px solid var(--vscode-button-border, var(--vscode-input-border))",
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
  },
  macroGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  macroBlock: {
    display: "grid",
    gap: 6,
  },
  macroTitle: {
    fontWeight: 600,
  },
  codeArea: {
    width: "100%",
    minHeight: 160,
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: 12,
    background: "var(--vscode-editor-background)",
    color: "var(--vscode-editor-foreground)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: 6,
    padding: 8,
    resize: "vertical",
  },
};
