import React, { useMemo, useRef, useState } from "react";
import { ModeTemplate, ModeTemplateTopic, ProtocolDesignDefinition, TopicConstraint, TopicRole, TopicType } from "../types";

type MacroFieldKey = "hostMacroTemplates" | "joinMacroTemplates";
type GlobalMacroKey = "hostMacroGlobal" | "joinMacroGlobal";

type Props = {
  value: ProtocolDesignDefinition | null;
  parseError?: string;
  hostErrors?: string[];
  onChange: (next: ProtocolDesignDefinition) => void;
};

const ROLE_OPTIONS: TopicRole[] = ["host", "join"];
const CONSTRAINT_OPTIONS: TopicConstraint[] = ["requirement", "obligation"];
const TYPE_OPTIONS: TopicType[] = ["abstraction", "integer", "string", "boolean"];
const COMMON_SNIPPETS = ["sub /...(...)", "job /...(...)", "-> {"];
const RESERVED_INSERTS = ["$", "trigger", "debug_msg"];

const defaultTopic = (): ModeTemplateTopic => ({
  name: "",
  role: "host",
  constraint: "requirement",
  type: "abstraction",
});

const defaultModeTemplate = (): ModeTemplate => ({
  name: "",
  topics: [],
  hostMacroTemplates: [],
  joinMacroTemplates: [],
});

export function PddEditor({ value, parseError, hostErrors, onChange }: Props) {
  const pdd: ProtocolDesignDefinition = value ?? {
    protocolDesignVersion: 1,
    hostMacroGlobal: { def: "", header: "", footer: "" },
    joinMacroGlobal: { def: "", header: "", footer: "" },
    modeTemplates: [],
  };
  const [collapsedTemplates, setCollapsedTemplates] = useState<Record<number, boolean>>({});
  const lineRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const template of pdd.modeTemplates ?? []) {
      const name = template.name.trim();
      if (!name) {
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [pdd.modeTemplates]);

  const updatePdd = (next: Partial<ProtocolDesignDefinition>) => {
    onChange({ ...pdd, ...next });
  };

  const updateGlobalMacro = (key: GlobalMacroKey, field: "def" | "header" | "footer", nextValue: string) => {
    updatePdd({
      [key]: {
        ...pdd[key],
        [field]: nextValue,
      },
    });
  };

  const updateTemplate = (index: number, partial: Partial<ModeTemplate>) => {
    const modeTemplates = [...(pdd.modeTemplates ?? [])];
    modeTemplates[index] = {
      ...(modeTemplates[index] ?? defaultModeTemplate()),
      ...partial,
    };
    updatePdd({ modeTemplates });
  };

  const addTemplate = () => {
    const modeTemplates = [...(pdd.modeTemplates ?? []), defaultModeTemplate()];
    updatePdd({ modeTemplates });
    setCollapsedTemplates((prev) => ({ ...prev, [modeTemplates.length - 1]: false }));
  };

  const moveTemplate = (index: number, delta: number) => {
    const modeTemplates = [...(pdd.modeTemplates ?? [])];
    const target = index + delta;
    if (target < 0 || target >= modeTemplates.length) {
      return;
    }
    const [item] = modeTemplates.splice(index, 1);
    modeTemplates.splice(target, 0, item);
    updatePdd({ modeTemplates });
  };

  const removeTemplate = (index: number) => {
    updatePdd({ modeTemplates: (pdd.modeTemplates ?? []).filter((_, i) => i !== index) });
  };

  const updateTopic = (templateIndex: number, topicIndex: number, partial: Partial<ModeTemplateTopic>) => {
    const template = pdd.modeTemplates?.[templateIndex] ?? defaultModeTemplate();
    const topics = [...(template.topics ?? [])];
    topics[topicIndex] = {
      ...(topics[topicIndex] ?? defaultTopic()),
      ...partial,
    };
    updateTemplate(templateIndex, { topics });
  };

  const addTopic = (templateIndex: number) => {
    const template = pdd.modeTemplates?.[templateIndex] ?? defaultModeTemplate();
    updateTemplate(templateIndex, { topics: [...(template.topics ?? []), defaultTopic()] });
  };

  const moveTopic = (templateIndex: number, topicIndex: number, delta: number) => {
    const template = pdd.modeTemplates?.[templateIndex] ?? defaultModeTemplate();
    const topics = [...(template.topics ?? [])];
    const target = topicIndex + delta;
    if (target < 0 || target >= topics.length) {
      return;
    }
    const [item] = topics.splice(topicIndex, 1);
    topics.splice(target, 0, item);
    updateTemplate(templateIndex, { topics });
  };

  const removeTopic = (templateIndex: number, topicIndex: number) => {
    const template = pdd.modeTemplates?.[templateIndex] ?? defaultModeTemplate();
    updateTemplate(templateIndex, { topics: (template.topics ?? []).filter((_, index) => index !== topicIndex) });
  };

  const addMacroLine = (templateIndex: number, key: MacroFieldKey) => {
    const template = pdd.modeTemplates?.[templateIndex] ?? defaultModeTemplate();
    updateTemplate(templateIndex, { [key]: [...(template[key] ?? []), ""] });
  };

  const updateMacroLine = (templateIndex: number, key: MacroFieldKey, lineIndex: number, nextValue: string) => {
    const template = pdd.modeTemplates?.[templateIndex] ?? defaultModeTemplate();
    const lines = [...(template[key] ?? [])];
    lines[lineIndex] = nextValue;
    updateTemplate(templateIndex, { [key]: lines });
  };

  const moveMacroLine = (templateIndex: number, key: MacroFieldKey, lineIndex: number, delta: number) => {
    const template = pdd.modeTemplates?.[templateIndex] ?? defaultModeTemplate();
    const lines = [...(template[key] ?? [])];
    const target = lineIndex + delta;
    if (target < 0 || target >= lines.length) {
      return;
    }
    const [item] = lines.splice(lineIndex, 1);
    lines.splice(target, 0, item);
    updateTemplate(templateIndex, { [key]: lines });
  };

  const removeMacroLine = (templateIndex: number, key: MacroFieldKey, lineIndex: number) => {
    const template = pdd.modeTemplates?.[templateIndex] ?? defaultModeTemplate();
    updateTemplate(templateIndex, { [key]: (template[key] ?? []).filter((_, index) => index !== lineIndex) });
  };

  const insertIntoGlobal = (key: GlobalMacroKey) => {
    const current = pdd[key]?.def ?? "";
    const spacer = current && !current.endsWith(" ") ? " " : "";
    updateGlobalMacro(key, "def", `${current}${spacer}$TOPICS`);
  };

  const insertIntoMacroLine = (
    templateIndex: number,
    key: MacroFieldKey,
    lineIndex: number,
    inserted: string
  ) => {
    const refKey = `${templateIndex}:${key}:${lineIndex}`;
    const textarea = lineRefs.current[refKey];
    const current = pdd.modeTemplates?.[templateIndex]?.[key]?.[lineIndex] ?? "";
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const nextValue = `${current.slice(0, start)}${inserted}${current.slice(end)}`;
    updateMacroLine(templateIndex, key, lineIndex, nextValue);
  };

  return (
    <div style={styles.shell}>
      {parseError ? <div style={styles.bannerError}>Unable to parse JSON: {parseError}</div> : null}
      {hostErrors && hostErrors.length > 0 ? (
        <div style={styles.bannerWarning}>
          <div style={styles.bannerTitle}>Validation</div>
          <ul style={styles.errorList}>
            {hostErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionTitle}>Definition</div>
        </div>
        <div style={styles.fieldGrid}>
          <label style={styles.labelBlock}>
            <span style={styles.label}>Protocol Design Version</span>
            <input
              type="number"
              style={styles.input}
              value={pdd.protocolDesignVersion ?? 1}
              onChange={(event) => updatePdd({ protocolDesignVersion: Number(event.target.value) || 1 })}
            />
          </label>
        </div>
      </section>

      <MacroGlobalCard
        title="Host Macro Wrapper"
        value={pdd.hostMacroGlobal}
        onChange={(field, nextValue) => updateGlobalMacro("hostMacroGlobal", field, nextValue)}
        onInsertTopics={() => insertIntoGlobal("hostMacroGlobal")}
      />
      <MacroGlobalCard
        title="Join Macro Wrapper"
        value={pdd.joinMacroGlobal}
        onChange={(field, nextValue) => updateGlobalMacro("joinMacroGlobal", field, nextValue)}
        onInsertTopics={() => insertIntoGlobal("joinMacroGlobal")}
      />

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionTitle}>Mode Templates</div>
          <button type="button" style={styles.primaryButton} onClick={addTemplate}>
            Add Mode Template
          </button>
        </div>
        {(pdd.modeTemplates ?? []).map((template, templateIndex) => {
          const name = (template.name ?? "").trim();
          const hasDuplicate = name.length > 0 && (duplicateNames.get(name) ?? 0) > 1;
          const collapsed = collapsedTemplates[templateIndex] ?? false;
          const topics = template.topics ?? [];
          const hostLines = template.hostMacroTemplates ?? [];
          const joinLines = template.joinMacroTemplates ?? [];
          return (
            <article key={`template:${templateIndex}`} style={styles.card}>
              <div style={styles.cardHeader}>
                <div>
                  <div style={styles.cardEyebrow}>Template {templateIndex}</div>
                  <div style={styles.cardTitle}>{name || "Untitled Mode Template"}</div>
                  <div style={styles.cardSubtitle}>
                    {topics.length} topic(s), {hostLines.length} host statement(s), {joinLines.length} join statement(s)
                  </div>
                </div>
                <div style={styles.cardActions}>
                  <button type="button" style={styles.smallButton} onClick={() => moveTemplate(templateIndex, -1)}>
                    Up
                  </button>
                  <button type="button" style={styles.smallButton} onClick={() => moveTemplate(templateIndex, 1)}>
                    Down
                  </button>
                  <button
                    type="button"
                    style={styles.smallButton}
                    onClick={() => setCollapsedTemplates((prev) => ({ ...prev, [templateIndex]: !collapsed }))}
                  >
                    {collapsed ? "Expand" : "Collapse"}
                  </button>
                  <button type="button" style={styles.dangerButton} onClick={() => removeTemplate(templateIndex)}>
                    Delete
                  </button>
                </div>
              </div>

              {collapsed ? null : (
                <>
                  <div style={styles.fieldGrid}>
                    <label style={styles.labelBlock}>
                      <span style={styles.label}>Template Name</span>
                      <input
                        type="text"
                        style={styles.input}
                        value={template.name}
                        onChange={(event) => updateTemplate(templateIndex, { name: event.target.value })}
                      />
                    </label>
                  </div>
                  <div style={styles.helperText}>Renaming this template changes the identifier that `.pdes` files reference.</div>
                  {hasDuplicate ? <div style={styles.inlineWarning}>Template names must be unique within the file.</div> : null}

                  <div style={styles.subSection}>
                    <div style={styles.subSectionHeader}>
                      <div style={styles.subSectionTitle}>Topics</div>
                      <button type="button" style={styles.smallPrimaryButton} onClick={() => addTopic(templateIndex)}>
                        Add Topic
                      </button>
                    </div>
                    {topics.map((topic, topicIndex) => (
                      <div key={`${templateIndex}:topic:${topicIndex}`} style={styles.topicCard}>
                        <div style={styles.topicHeader}>
                          <div style={styles.topicTitle}>Topic {topicIndex}</div>
                          <div style={styles.cardActions}>
                            <button
                              type="button"
                              style={styles.smallButton}
                              onClick={() => moveTopic(templateIndex, topicIndex, -1)}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              style={styles.smallButton}
                              onClick={() => moveTopic(templateIndex, topicIndex, 1)}
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              style={styles.smallButton}
                              onClick={() => removeTopic(templateIndex, topicIndex)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <div style={styles.topicGrid}>
                          <label style={styles.labelBlock}>
                            <span style={styles.label}>Name</span>
                            <input
                              type="text"
                              style={styles.input}
                              value={topic.name}
                              onChange={(event) => updateTopic(templateIndex, topicIndex, { name: event.target.value })}
                            />
                          </label>
                          <SelectField
                            label="Role"
                            value={topic.role}
                            options={ROLE_OPTIONS}
                            onChange={(nextValue) => updateTopic(templateIndex, topicIndex, { role: nextValue as TopicRole })}
                          />
                          <SelectField
                            label="Constraint"
                            value={topic.constraint}
                            options={CONSTRAINT_OPTIONS}
                            onChange={(nextValue) =>
                              updateTopic(templateIndex, topicIndex, { constraint: nextValue as TopicConstraint })
                            }
                          />
                          <SelectField
                            label="Type"
                            value={topic.type}
                            options={TYPE_OPTIONS}
                            onChange={(nextValue) => updateTopic(templateIndex, topicIndex, { type: nextValue as TopicType })}
                          />
                        </div>
                        <label style={styles.labelBlock}>
                          <span style={styles.label}>Comment</span>
                          <textarea
                            style={styles.textarea}
                            rows={2}
                            value={topic.comment ?? ""}
                            onChange={(event) => updateTopic(templateIndex, topicIndex, { comment: event.target.value })}
                          />
                        </label>
                      </div>
                    ))}
                    {topics.length === 0 ? <div style={styles.emptyState}>No topics yet.</div> : null}
                  </div>

                  <div style={styles.tokenPanel}>
                    <div style={styles.subSectionTitle}>Topic Token Reference</div>
                    {topics.length === 0 ? (
                      <div style={styles.helperText}>Add topics to unlock `$TOPIC_n` insertion helpers.</div>
                    ) : (
                      topics.map((topic, topicIndex) => (
                        <div key={`${templateIndex}:ref:${topicIndex}`} style={styles.tokenRow}>
                          <code style={styles.tokenCode}>{`$TOPIC_${topicIndex}`}</code>
                          <span>{topic.name || "Unnamed topic"}</span>
                          <span style={styles.tokenMeta}>
                            {topic.role} / {topic.constraint} / {topic.type}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <MacroStatementsEditor
                    title="Host Macro Statements"
                    template={template}
                    templateIndex={templateIndex}
                    macroKey="hostMacroTemplates"
                    lineRefs={lineRefs}
                    onAdd={() => addMacroLine(templateIndex, "hostMacroTemplates")}
                    onChange={(lineIndex, nextValue) => updateMacroLine(templateIndex, "hostMacroTemplates", lineIndex, nextValue)}
                    onMove={(lineIndex, delta) => moveMacroLine(templateIndex, "hostMacroTemplates", lineIndex, delta)}
                    onRemove={(lineIndex) => removeMacroLine(templateIndex, "hostMacroTemplates", lineIndex)}
                    onInsert={(lineIndex, inserted) => insertIntoMacroLine(templateIndex, "hostMacroTemplates", lineIndex, inserted)}
                  />
                  <MacroStatementsEditor
                    title="Join Macro Statements"
                    template={template}
                    templateIndex={templateIndex}
                    macroKey="joinMacroTemplates"
                    lineRefs={lineRefs}
                    onAdd={() => addMacroLine(templateIndex, "joinMacroTemplates")}
                    onChange={(lineIndex, nextValue) => updateMacroLine(templateIndex, "joinMacroTemplates", lineIndex, nextValue)}
                    onMove={(lineIndex, delta) => moveMacroLine(templateIndex, "joinMacroTemplates", lineIndex, delta)}
                    onRemove={(lineIndex) => removeMacroLine(templateIndex, "joinMacroTemplates", lineIndex)}
                    onInsert={(lineIndex, inserted) => insertIntoMacroLine(templateIndex, "joinMacroTemplates", lineIndex, inserted)}
                  />
                </>
              )}
            </article>
          );
        })}
        {(pdd.modeTemplates ?? []).length === 0 ? <div style={styles.emptyState}>No mode templates yet.</div> : null}
      </section>
    </div>
  );
}

function MacroGlobalCard({
  title,
  value,
  onChange,
  onInsertTopics,
}: {
  title: string;
  value: ProtocolDesignDefinition["hostMacroGlobal"];
  onChange: (field: "def" | "header" | "footer", nextValue: string) => void;
  onInsertTopics: () => void;
}) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <div style={styles.sectionTitle}>{title}</div>
        <button type="button" style={styles.smallPrimaryButton} onClick={onInsertTopics}>
          Insert $TOPICS
        </button>
      </div>
      <div style={styles.helperText}>
        `$TOPICS` expands to all requirement identifiers followed by all obligation identifiers during `.pdes` export.
      </div>
      <label style={styles.labelBlock}>
        <span style={styles.label}>def</span>
        <textarea style={styles.textarea} rows={2} value={value?.def ?? ""} onChange={(event) => onChange("def", event.target.value)} />
      </label>
      <label style={styles.labelBlock}>
        <span style={styles.label}>header</span>
        <textarea
          style={styles.textarea}
          rows={3}
          value={value?.header ?? ""}
          onChange={(event) => onChange("header", event.target.value)}
        />
      </label>
      <label style={styles.labelBlock}>
        <span style={styles.label}>footer</span>
        <textarea
          style={styles.textarea}
          rows={3}
          value={value?.footer ?? ""}
          onChange={(event) => onChange("footer", event.target.value)}
        />
      </label>
    </section>
  );
}

function MacroStatementsEditor({
  title,
  template,
  templateIndex,
  macroKey,
  lineRefs,
  onAdd,
  onChange,
  onMove,
  onRemove,
  onInsert,
}: {
  title: string;
  template: ModeTemplate;
  templateIndex: number;
  macroKey: MacroFieldKey;
  lineRefs: React.MutableRefObject<Record<string, HTMLTextAreaElement | null>>;
  onAdd: () => void;
  onChange: (lineIndex: number, nextValue: string) => void;
  onMove: (lineIndex: number, delta: number) => void;
  onRemove: (lineIndex: number) => void;
  onInsert: (lineIndex: number, inserted: string) => void;
}) {
  const lines = template[macroKey] ?? [];
  return (
    <div style={styles.subSection}>
      <div style={styles.subSectionHeader}>
        <div style={styles.subSectionTitle}>{title}</div>
        <button type="button" style={styles.smallPrimaryButton} onClick={onAdd}>
          Add Statement
        </button>
      </div>
      {lines.map((line, lineIndex) => {
        const warnings = getLineWarnings(template, line, macroKey === "hostMacroTemplates" ? "host" : "join");
        const refKey = `${templateIndex}:${macroKey}:${lineIndex}`;
        return (
          <div key={refKey} style={styles.macroCard}>
            <div style={styles.topicHeader}>
              <div style={styles.topicTitle}>Statement {lineIndex}</div>
              <div style={styles.cardActions}>
                <button type="button" style={styles.smallButton} onClick={() => onMove(lineIndex, -1)}>
                  Up
                </button>
                <button type="button" style={styles.smallButton} onClick={() => onMove(lineIndex, 1)}>
                  Down
                </button>
                <button type="button" style={styles.smallButton} onClick={() => onRemove(lineIndex)}>
                  Remove
                </button>
              </div>
            </div>
            <div style={styles.insertRow}>
              <select style={styles.select} defaultValue="" onChange={(event) => {
                if (event.target.value) {
                  onInsert(lineIndex, event.target.value);
                  event.target.value = "";
                }
              }}>
                <option value="">Insert Topic Token</option>
                {template.topics.map((topic, topicIndex) => (
                  <option key={`${refKey}:topic:${topicIndex}`} value={`$TOPIC_${topicIndex}`}>
                    {`Topic ${topicIndex}: ${topic.name || "Unnamed topic"}`}
                  </option>
                ))}
              </select>
              <select style={styles.select} defaultValue="" onChange={(event) => {
                if (event.target.value) {
                  onInsert(lineIndex, event.target.value);
                  event.target.value = "";
                }
              }}>
                <option value="">Insert Common Snippet</option>
                {COMMON_SNIPPETS.map((snippet) => (
                  <option key={`${refKey}:snippet:${snippet}`} value={snippet}>
                    {snippet}
                  </option>
                ))}
              </select>
              {RESERVED_INSERTS.map((reserved) => (
                <button key={`${refKey}:reserved:${reserved}`} type="button" style={styles.smallButton} onClick={() => onInsert(lineIndex, reserved)}>
                  {reserved}
                </button>
              ))}
            </div>
            <textarea
              ref={(node) => {
                lineRefs.current[refKey] = node;
              }}
              style={styles.textarea}
              rows={3}
              value={line}
              onChange={(event) => onChange(lineIndex, event.target.value)}
            />
            <div style={styles.helperText}>{describeTokens(template, line)}</div>
            {warnings.map((warning) => (
              <div key={`${refKey}:${warning}`} style={styles.inlineWarning}>
                {warning}
              </div>
            ))}
          </div>
        );
      })}
      {lines.length === 0 ? <div style={styles.emptyState}>No statements yet.</div> : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (nextValue: string) => void;
}) {
  return (
    <label style={styles.labelBlock}>
      <span style={styles.label}>{label}</span>
      <select style={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={`${label}:${option}`} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function describeTokens(template: ModeTemplate, line: string) {
  const tokens = Array.from(line.matchAll(/\$TOPIC_(\d+)/g));
  if (tokens.length === 0) {
    return "No topic tokens referenced in this statement.";
  }
  return tokens
    .map((match) => {
      const index = Number(match[1]);
      const topic = template.topics[index];
      return topic ? `${match[0]} -> ${topic.name || `Topic ${index}`}` : `${match[0]} -> missing topic`;
    })
    .join(" | ");
}

function getLineWarnings(template: ModeTemplate, line: string, macroRole: TopicRole) {
  const warnings: string[] = [];
  for (const match of line.matchAll(/\$TOPIC_(\d+)/g)) {
    const index = Number(match[1]);
    const topic = template.topics[index];
    if (!topic) {
      warnings.push(`${match[0]} does not exist for this template.`);
    }
  }
  for (const match of line.matchAll(/\$TOPIC_([^\d\s,()]+)/g)) {
    warnings.push(`Malformed token ${match[0]}. Use $TOPIC_<index>.`);
  }

  const topicRefs = Array.from(line.matchAll(/\$TOPIC_(\d+)/g))
    .map((match) => template.topics[Number(match[1])])
    .filter(Boolean);
  if (topicRefs.length > 0 && topicRefs.every((topic) => topic.role !== macroRole)) {
    warnings.push(`${macroRole} statement only references ${macroRole === "host" ? "join" : "host"} topics.`);
  }

  return Array.from(new Set(warnings));
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  section: {
    border: "1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.12))",
    borderRadius: 14,
    padding: 16,
    background: "var(--vscode-sideBar-background, rgba(255,255,255,0.03))",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  labelBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--vscode-descriptionForeground)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  input: {
    borderRadius: 8,
    border: "1px solid var(--vscode-input-border, transparent)",
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
    padding: "8px 10px",
  },
  select: {
    borderRadius: 8,
    border: "1px solid var(--vscode-dropdown-border, transparent)",
    background: "var(--vscode-dropdown-background)",
    color: "var(--vscode-dropdown-foreground)",
    padding: "8px 10px",
  },
  textarea: {
    width: "100%",
    borderRadius: 8,
    border: "1px solid var(--vscode-input-border, transparent)",
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
    padding: "8px 10px",
    resize: "vertical",
    boxSizing: "border-box",
  },
  helperText: {
    fontSize: 12,
    color: "var(--vscode-descriptionForeground)",
    marginTop: 6,
  },
  primaryButton: {
    borderRadius: 999,
    padding: "8px 14px",
    border: "1px solid transparent",
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    cursor: "pointer",
  },
  smallPrimaryButton: {
    borderRadius: 999,
    padding: "6px 12px",
    border: "1px solid transparent",
    background: "var(--vscode-button-secondaryBackground, var(--vscode-button-background))",
    color: "var(--vscode-button-secondaryForeground, var(--vscode-button-foreground))",
    cursor: "pointer",
  },
  smallButton: {
    borderRadius: 999,
    padding: "6px 10px",
    border: "1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.12))",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  dangerButton: {
    borderRadius: 999,
    padding: "6px 10px",
    border: "1px solid rgba(255, 120, 120, 0.4)",
    background: "rgba(255, 120, 120, 0.12)",
    color: "var(--vscode-errorForeground)",
    cursor: "pointer",
  },
  card: {
    border: "1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.12))",
    borderRadius: 14,
    padding: 14,
    background: "rgba(127,127,127,0.05)",
    marginBottom: 14,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    marginBottom: 12,
  },
  cardEyebrow: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--vscode-descriptionForeground)",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 700,
  },
  cardSubtitle: {
    fontSize: 12,
    color: "var(--vscode-descriptionForeground)",
    marginTop: 4,
  },
  cardActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  subSection: {
    marginTop: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  subSectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  subSectionTitle: {
    fontSize: 14,
    fontWeight: 700,
  },
  topicCard: {
    border: "1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.12))",
    borderRadius: 12,
    padding: 12,
    background: "rgba(127,127,127,0.04)",
  },
  topicHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  topicTitle: {
    fontSize: 13,
    fontWeight: 700,
  },
  topicGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
    marginBottom: 10,
  },
  tokenPanel: {
    border: "1px dashed var(--vscode-editorWidget-border, rgba(255,255,255,0.18))",
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  tokenRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    fontSize: 12,
    padding: "4px 0",
  },
  tokenCode: {
    padding: "2px 6px",
    borderRadius: 6,
    background: "rgba(127,127,127,0.18)",
  },
  tokenMeta: {
    color: "var(--vscode-descriptionForeground)",
  },
  macroCard: {
    border: "1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.12))",
    borderRadius: 12,
    padding: 12,
  },
  insertRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  emptyState: {
    fontSize: 13,
    color: "var(--vscode-descriptionForeground)",
    padding: "6px 0",
  },
  inlineWarning: {
    fontSize: 12,
    color: "var(--vscode-editorWarning-foreground, #d7ba7d)",
    marginTop: 6,
  },
  bannerError: {
    borderRadius: 12,
    padding: 12,
    background: "rgba(255, 107, 107, 0.12)",
    color: "var(--vscode-errorForeground)",
  },
  bannerWarning: {
    borderRadius: 12,
    padding: 12,
    background: "rgba(215, 186, 125, 0.12)",
    color: "var(--vscode-editorWarning-foreground, #d7ba7d)",
  },
  bannerTitle: {
    fontWeight: 700,
    marginBottom: 6,
  },
  errorList: {
    margin: 0,
    paddingLeft: 18,
  },
};
