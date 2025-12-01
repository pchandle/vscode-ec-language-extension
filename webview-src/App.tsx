import React, { useEffect, useMemo, useState, useRef } from "react";
import Form, { IChangeEvent } from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import {
  ArrayFieldTemplateProps,
  ErrorListProps,
  FieldTemplateProps,
  ObjectFieldTemplateProps,
  RJSFSchema,
  RJSFValidationError,
  UiSchema,
  ErrorSchema,
} from "@rjsf/utils";
import { HostMessage, WebviewMessage } from "./types";
import { vscode } from "./vscode";
import { PdesEditor } from "./pdes/PdesEditor";

type FormData = Record<string, unknown> | null | undefined;

const TrashIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 4h6m-8 3h10l-1 13H8L7 7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M5 7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const REQUIREMENT_TYPE_OPTIONS = [
  { value: "abstraction", label: "Protocol" },
  { value: "integer", label: "Integer" },
  { value: "string", label: "String" },
  { value: "boolean", label: "Boolean" },
  { value: "site", label: "Site" },
];

export default function App() {
  const [schema, setSchema] = useState<any>();
  const [formData, setFormData] = useState<FormData>({});
  const [pdesData, setPdesData] = useState<any | null>(null);
  const [pdd, setPdd] = useState<any | null>(null);
  const [pddPath, setPddPath] = useState<string | undefined>();
  const [protocolCompletions, setProtocolCompletions] = useState<string[]>([]);
  const [hostErrors, setHostErrors] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | undefined>();
  const [formErrors, setFormErrors] = useState<RJSFValidationError[]>([]);
  const [collapsedState, setCollapsedState] = useState<Record<string, Record<string, boolean>>>({});
  const pendingUpdate = useRef<number | undefined>(undefined);
  const validationTimer = useRef<number | undefined>(undefined);
  const [extraErrors, setExtraErrors] = useState<ErrorSchema | undefined>();
  const liveFormDataRef = useRef<FormData>({});
  const [formVersion, setFormVersion] = useState(0);
  const [editorMode, setEditorMode] = useState<"schema" | "pdes">("schema");

  useEffect(() => {
    const handler = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === "state") {
        setEditorMode("schema");
        setSchema(message.schema);
        const nextValue = message.value ?? {};
        setFormData(nextValue);
        setPdesData(null);
        liveFormDataRef.current = nextValue;
        setFormVersion((v) => v + 1);
        setHostErrors(message.errors ?? []);
        setParseError(message.parseError);
        setFormErrors([]);
        setProtocolCompletions([]);
      } else if (message.type === "pdesState") {
        setEditorMode("pdes");
        setSchema(undefined);
        setFormData(undefined);
        const nextValue = message.value ?? {};
        setPdesData(nextValue);
        setPdd((message as any).pdd ?? null);
        setPddPath((message as any).pddPath);
        liveFormDataRef.current = nextValue;
        setHostErrors(message.errors ?? []);
        setParseError(message.parseError);
        setFormErrors([]);
        setProtocolCompletions((message as any).protocolCompletions ?? []);
      }
    };

    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" } as WebviewMessage);

    return () => {
      window.removeEventListener("message", handler);
    };
  }, []);

  const enhancedSchema: RJSFSchema | undefined = useMemo(() => {
    if (!schema) {
      return undefined;
    }

    const clone = JSON.parse(JSON.stringify(schema));
    const applyRequirementOptions = (node: any) => {
      if (!node?.properties) {
        return;
      }
      if (node.properties.type) {
        node.properties.type.enum = REQUIREMENT_TYPE_OPTIONS.map((opt) => opt.value);
        node.properties.type.enumNames = REQUIREMENT_TYPE_OPTIONS.map((opt) => opt.label);
      }
      if (node.properties.protocol) {
        node.properties.protocol.title = "protocol";
        node.properties.protocol.pattern = "^/(?:[a-z0-9-]+/){3}[a-z0-9-]+$";
      }
      if (node.properties.name) {
        node.properties.name.pattern = "^[\\w .(),-]+$";
      }
      if (node.properties.length) {
        node.properties.length.type = "integer";
      }
      if (node.properties.minimum) {
        node.properties.minimum.type = "integer";
      }
      if (node.properties.maximum) {
        node.properties.maximum.type = "integer";
      }
      if (node.properties.hint) {
        // Printable ASCII excluding backslash and double-quote to avoid escape needs
        node.properties.hint.type = "string";
        node.properties.hint.pattern = "^[\\x20\\x21\\x23-\\x5B\\x5D-\\x7E]*$";
      }

      // Replace oneOf selector with if/then so RJSF doesn't render "Option 1/2/3".
      node.allOf = [
        {
          if: { properties: { type: { const: "abstraction" } } },
          then: { required: ["protocol"] },
        },
        {
          if: { properties: { type: { const: "integer" } } },
          then: { required: ["minimum", "maximum", "hint"] },
        },
        {
          if: { properties: { type: { const: "string" } } },
          then: { required: ["length", "hint"] },
        },
      ];
      delete node.oneOf;
    };

    applyRequirementOptions(clone?.$defs?.requirement);
    applyRequirementOptions(clone?.$defs?.obligation);

    return clone;
  }, [schema]);

  const uiSchema: UiSchema = useMemo(() => {
    const buildRequirementUi = (): UiSchema => ({
      "ui:options": { orderable: true },
      items: {
        "ui:ObjectFieldTemplate": RequirementObjectTemplate,
        "ui:order": ["type", "name", "protocol", "minimum", "maximum", "length", "hint"],
        type: { "ui:widget": "select", "ui:placeholder": "Type" },
        protocol: {
          "ui:title": "protocol",
          "ui:placeholder": "Enter protocol",
        },
      },
    });

    return {
      "ui:title": "",
      "ui:order": ["name", "description", "supplier", "requirements", "obligations", "host", "join", "*"],
      type: { "ui:widget": "hidden", "ui:options": { label: false } },
      description: { "ui:widget": "textarea", "ui:options": { rows: 3 } },
      requirements: buildRequirementUi(),
      obligations: buildRequirementUi(),
      host: {
        requirements: buildRequirementUi(),
        obligations: buildRequirementUi(),
      },
      join: {
        requirements: buildRequirementUi(),
        obligations: buildRequirementUi(),
      },
    };
  }, []);

  const templates = useMemo(
    () => ({
      ArrayFieldTemplate: CardArrayFieldTemplate,
      FieldTemplate: CompactFieldTemplate,
      ObjectFieldTemplate: SectionObjectTemplate,
      ErrorListTemplate: SlimErrorList,
    }),
    []
  );

  const formContext = useMemo(
    () => ({
      collapsedState,
      formErrors,
      toggleItem: (path: string, key: string) => {
        setCollapsedState((prev) => {
          const next = { ...prev };
          const byPath = { ...(next[path] ?? {}) };
          byPath[key] = !byPath[key];
          next[path] = byPath;
          return next;
        });
      },
      setKeys: (path: string, collapsed: boolean, keys: string[]) => {
        setCollapsedState((prev) => {
          const next = { ...prev };
          const byPath: Record<string, boolean> = { ...(next[path] ?? {}) };
          for (const key of keys) {
            byPath[key] = collapsed;
          }
          next[path] = byPath;
          return next;
        });
      },
      setAll: (path: string, collapsed: boolean, keys: string[]) => {
        setCollapsedState((prev) => {
          const next = { ...prev };
          const byPath: Record<string, boolean> = { ...(next[path] ?? {}) };
          for (const key of keys) {
            byPath[key] = collapsed;
          }
          next[path] = byPath;
          return next;
        });
      },
    }),
    [collapsedState, formErrors]
  );

  const hasErrors = useMemo(() => {
    return Boolean(parseError || (hostErrors && hostErrors.length > 0));
  }, [parseError, hostErrors]);

  const [errorsCollapsed, setErrorsCollapsed] = useState(true);

  const onChange = (data: IChangeEvent) => {
    liveFormDataRef.current = data.formData;
    setFormData(data.formData);
    // Defer validation; handled by debounced effect
    if (pendingUpdate.current) {
      window.clearTimeout(pendingUpdate.current);
    }
    pendingUpdate.current = window.setTimeout(() => {
      vscode.postMessage({ type: "updateDoc", value: liveFormDataRef.current } as WebviewMessage);
      pendingUpdate.current = undefined;
    }, 250);
  };

  const onBlur = () => {
    scheduleValidation(0);
  };

  useEffect(() => {
    return () => {
      if (pendingUpdate.current) {
        window.clearTimeout(pendingUpdate.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!enhancedSchema && !schema) {
      return;
    }
    // Run validation when host sends new data
    scheduleValidation(0);
    return () => {
      if (validationTimer.current) {
        window.clearTimeout(validationTimer.current);
      }
    };
  }, [formVersion, enhancedSchema, schema, uiSchema]);

  const scheduleValidation = (delayMs: number) => {
    if (validationTimer.current) {
      window.clearTimeout(validationTimer.current);
    }
    validationTimer.current = window.setTimeout(() => {
      const activeSchema = enhancedSchema ?? schema;
      if (!activeSchema) {
        return;
      }
      const result = validator.validateFormData(
        (liveFormDataRef.current ?? {}) as any,
        activeSchema as any,
        undefined,
        undefined,
        uiSchema
      );
      setFormErrors(result.errors ?? []);
      const nextErrorSchema = result.errorSchema;
      setExtraErrors(hasErrorsInSchema(nextErrorSchema) ? nextErrorSchema : undefined);
      validationTimer.current = undefined;
    }, delayMs);
  };

  if (editorMode === "pdes") {
    return (
      <div style={styles.container}>
        <style
          dangerouslySetInnerHTML={{
            __html: `
            input, select, textarea, button {
              font-family: var(--vscode-font-family, "Segoe WPC", "Segoe UI", sans-serif);
              font-size: 13px;
            }
          `,
          }}
        />
        <header style={styles.header}>
          <div style={styles.title}>Protocol Design</div>
          <div style={styles.headerActions}>
            {hostErrors.length > 0 ? <div style={styles.errorBadge}>Errors</div> : <div style={styles.okBadge}>Valid</div>}
          </div>
        </header>
        {parseError ? <div style={styles.bannerError}>Unable to parse JSON: {parseError}</div> : null}
        {hostErrors.length > 0 ? (
          <div style={styles.bannerWarning}>
            <div style={styles.bannerTitle}>Validation</div>
            <ul style={styles.errorList}>
              {hostErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <PdesEditor
          value={pdesData}
          pdd={pdd}
          pddPath={pddPath}
          protocolCompletions={protocolCompletions}
          onChange={(next) => {
            liveFormDataRef.current = next;
            setPdesData(next);
            if (pendingUpdate.current) {
              window.clearTimeout(pendingUpdate.current);
            }
            pendingUpdate.current = window.setTimeout(() => {
              vscode.postMessage({ type: "updateDoc", value: liveFormDataRef.current } as WebviewMessage);
              pendingUpdate.current = undefined;
            }, 250);
          }}
        />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <style
        // enforce consistent font on all form controls
        dangerouslySetInnerHTML={{
          __html: `
            input, select, textarea, button {
              font-family: var(--vscode-font-family, "Segoe WPC", "Segoe UI", sans-serif);
              font-size: 13px;
            }
          `,
        }}
      />
      <header style={styles.header}>
        <div style={styles.title}>Contract Specification</div>
        <div style={styles.headerActions}>
          {hostErrors.length > 0 ? (
            <button
              type="button"
              style={styles.collapseButton}
              onClick={() => setErrorsCollapsed((v) => !v)}
              aria-label={errorsCollapsed ? "Show errors" : "Hide errors"}
            >
              {errorsCollapsed ? "Show errors" : "Hide errors"}
            </button>
          ) : null}
          {hasErrors ? <div style={styles.errorBadge}>Errors</div> : <div style={styles.okBadge}>Valid</div>}
        </div>
      </header>

      {parseError ? (
        <div style={styles.bannerError}>Unable to parse JSON: {parseError}</div>
      ) : null}

      {hostErrors.length > 0 && !errorsCollapsed ? (
        <div style={styles.bannerWarning}>
          <div style={styles.bannerTitle}>Schema validation</div>
          <ul style={styles.errorList}>
            {hostErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!schema ? (
        <div style={styles.bannerInfo}>Loading schema…</div>
      ) : parseError ? (
        <div style={styles.bannerInfo}>Fix the JSON syntax to enable the form.</div>
      ) : (
        <Form
          schema={enhancedSchema ?? schema}
          validator={validator}
          formData={formData ?? {}}
          liveValidate={false}
          showErrorList
          uiSchema={uiSchema}
          templates={templates}
          extraErrors={extraErrors}
          formContext={formContext}
          noHtml5Validate
          onChange={onChange}
          onBlur={onBlur}
        >
          <></>
        </Form>
      )}
    </div>
  );
}

function CardArrayFieldTemplate<T>(props: ArrayFieldTemplateProps<T>) {
  const { title, items, canAdd, onAddClick, required, formData, errorSchema, idSchema, formContext } = props;
  const path = idSchema.$id;
  const collapsedMap: Record<string, boolean> = (formContext as any)?.collapsedState?.[path] ?? {};
  const prevKeysRef = useRef<string[]>([]);

  const itemHasErrors = (index: number) => hasErrorsInSchema((errorSchema as any)?.[index]);
  const itemDataAt = (index: number) => (Array.isArray(formData) ? (formData as any)[index] : undefined);
  const allKeys = items.map((item) => item.key);

  useEffect(() => {
    const prevKeys = prevKeysRef.current;
    const currentKeys = items.map((item) => item.key);
    const newKeys = currentKeys.filter((k) => !prevKeys.includes(k));
    if (prevKeys.length > 0 && newKeys.length > 0) {
      (formContext as any)?.setKeys?.(path, false, newKeys);
    }
    prevKeysRef.current = currentKeys;
  }, [items, formContext, path]);

  return (
    <div style={styles.arraySection}>
      <div style={styles.sectionHeader}>
        <div style={styles.sectionTitle}>
          {title}
          {required ? <span style={styles.requiredMarker}>*</span> : null}
        </div>
        <div style={styles.sectionActions}>
          {items.length > 0 ? (
            <>
              <button
                type="button"
                style={styles.smallButton}
                onClick={() => (formContext as any)?.setAll?.(path, false, allKeys)}
              >
                Expand all
              </button>
              <button
                type="button"
                style={styles.smallButton}
                onClick={() => (formContext as any)?.setAll?.(path, true, allKeys)}
              >
                Collapse all
              </button>
            </>
          ) : null}
          {canAdd ? (
            <button type="button" style={styles.addButton} onClick={onAddClick}>
              + Add {title?.replace(/s$/i, "") ?? "item"}
            </button>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <div style={styles.emptyState}>No {title?.toLowerCase() ?? "items"} yet.</div>
      ) : (
        items.map((item) => {
          const data = itemDataAt(item.index) ?? {};
          const displayType = requirementLabelFromValue((data as any).type) ?? `#${item.index + 1}`;
          const displayName = (data as any).name || `Item ${item.index + 1}`;
          const itemErrorSchema =
            (item as any).errorSchema ?? (errorSchema as any)?.[item.index] ?? (errorSchema as any)?.[String(item.index)];
          const extraItemErrors = getExtraErrorsForItem((formContext as any)?.formErrors, idSchema, item.index);
          const rawItemErrors = ((itemErrorSchema as any)?.__errors ?? []) as string[];
          const showError =
            hasErrorsInSchema(itemErrorSchema) ||
            Boolean(rawItemErrors.length) ||
            Boolean((item as any).rawErrors && (item as any).rawErrors.length) ||
            hasErrorsInSchema(extraItemErrors);
          const itemErrors = rawItemErrors.length
            ? rawItemErrors
            : ((item as any).rawErrors ?? []) as string[];
          const collapsed = collapsedMap[item.key] ?? true;
          const hasAnyErrors = showError || (itemErrors && itemErrors.length > 0);
          return (
            <div
              key={item.key}
              style={{
                ...styles.card,
                borderWidth: hasAnyErrors ? "2px" : "1px",
                borderColor: hasAnyErrors ? "#f0b400" : styles.card.borderColor,
                boxShadow: hasAnyErrors ? "0 0 0 1px #f0b400" : undefined,
              }}
            >
              <div style={styles.cardHeader}>
                <div style={styles.cardActionsLeft}>
                  <button
                    type="button"
                    style={styles.collapseButton}
                    aria-label={collapsed ? "Expand" : "Collapse"}
                    onClick={() => (formContext as any)?.toggleItem?.(path, item.key)}
                  >
                    {collapsed ? "▸" : "▾"}
                  </button>
                  {item.hasMoveUp ? (
                    <button
                      type="button"
                      style={styles.iconButton}
                      aria-label="Move up"
                      onClick={item.onReorderClick(item.index, item.index - 1)}
                    >
                      ↑
                    </button>
                  ) : (
                    <span style={styles.placeholderButton} />
                  )}
                  {item.hasMoveDown ? (
                    <button
                      type="button"
                      style={styles.iconButton}
                      aria-label="Move down"
                      onClick={item.onReorderClick(item.index, item.index + 1)}
                    >
                      ↓
                    </button>
                  ) : (
                    <span style={styles.placeholderButton} />
                  )}
                </div>
                <div style={styles.cardTitle}>
                  <span style={styles.typeBadge}>{displayType}</span>
                  <span style={styles.cardName}>{displayName}</span>
                </div>
                <div style={styles.cardActionsRight}>
                  {item.hasRemove ? (
                    <button
                      type="button"
                      style={styles.dangerButton}
                      aria-label="Remove item"
                      title="Remove"
                      onClick={item.onDropIndexClick(item.index)}
                    >
                      {TrashIcon}
                    </button>
                  ) : (
                    <span style={styles.placeholderButton} />
                  )}
                </div>
              </div>
              {!collapsed ? <div style={styles.cardBody}>{item.children}</div> : null}
              {showError && itemErrors.length ? (
                <ul style={styles.itemErrorList}>
                  {itemErrors.map((err: string) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function CompactFieldTemplate(props: FieldTemplateProps) {
  const { id, classNames, label, required, description, children, rawErrors, schema, hidden } = props;

  if (hidden) {
    return <div style={{ display: "none" }}>{children}</div>;
  }

  // Arrays and root container already render their own headers inside custom templates; skip outer label row.
  const isArrayField = schema?.type === "array";
  const isRoot = id === "root";
  const isArrayItemWrapper =
    schema?.type === "object" && (id.includes("_requirements_") || id.includes("_obligations_"));

  if (isArrayField || isRoot || isArrayItemWrapper) {
    return <div className={classNames}>{children}</div>;
  }

  return (
    <div className={classNames} style={styles.fieldRow}>
      {label ? (
        <label htmlFor={id} style={styles.fieldLabel}>
          {label}
          {required ? <span style={styles.requiredMarker}>*</span> : null}
        </label>
      ) : null}
      <div style={styles.fieldControl}>
        {children}
        {description}
        {rawErrors && rawErrors.length > 0 ? (
          <div style={styles.inlineErrors}>
            {rawErrors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SectionObjectTemplate(props: ObjectFieldTemplateProps) {
  return (
    <div style={styles.objectSection}>
      {props.title ? (
        <div style={styles.sectionHeader}>
          <div style={styles.sectionTitle}>
            {props.title}
            {props.required ? <span style={styles.requiredMarker}>*</span> : null}
          </div>
        </div>
      ) : null}
      <div style={styles.objectGrid}>
        {props.properties.map((property) =>
          property.hidden ? property.content : (
            <div key={property.name} style={styles.objectField}>
              {property.content}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function RequirementObjectTemplate(props: ObjectFieldTemplateProps) {
  const typeValue = (props.formData as any)?.type;
  const allowed = allowedRequirementProps(typeValue);
  return (
    <div style={styles.objectSection}>
      <div style={styles.objectGrid}>
        {props.properties
          .filter((property) => allowed.has(property.name))
          .map((property) =>
            property.hidden ? property.content : (
              <div key={property.name} style={styles.objectField}>
                {property.content}
              </div>
            )
          )}
      </div>
    </div>
  );
}

function allowedRequirementProps(typeValue: string | undefined) {
  const base = new Set(["type", "name"]);
  switch (typeValue) {
    case "abstraction":
      base.add("protocol");
      break;
    case "integer":
      base.add("minimum");
      base.add("maximum");
      base.add("hint");
      break;
    case "string":
      base.add("length");
      base.add("hint");
      break;
    default:
      break;
  }
  return base;
}

function SlimErrorList<T>({ errors }: ErrorListProps<T>) {
  if (!errors || errors.length === 0) {
    return null;
  }

  return (
    <div style={styles.formErrorList}>
      <div style={styles.bannerTitle}>Validation</div>
      <ul style={styles.errorList}>
        {errors.map((error, index) => (
          <li key={index}>{error.stack}</li>
        ))}
      </ul>
    </div>
  );
}

function requirementLabelFromValue(value: unknown) {
  if (!value) {
    return undefined;
  }
  const match = REQUIREMENT_TYPE_OPTIONS.find((item) => item.value === value);
  return match?.label ?? String(value);
}

function hasErrorsInSchema(node: any): boolean {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (Array.isArray(node.__errors) && node.__errors.length > 0) {
    return true;
  }
  return Object.values(node).some((value) => hasErrorsInSchema(value));
}

function getExtraErrorsForItem(errors: RJSFValidationError[] | undefined, idSchema: any, index: number) {
  if (!errors || errors.length === 0) {
    return undefined;
  }
  const pathId: string = idSchema?.$id ?? "";
  const parts = pathId.replace(/^root_?/, "").split("_").filter(Boolean);
  const pathPrefix = `.${parts.join(".")}.${index}`;
  const matching = errors.filter((err) => typeof err.property === "string" && err.property.startsWith(pathPrefix));
  if (matching.length === 0) {
    return undefined;
  }
  return { __errors: matching.map((m) => m.message || m.stack).filter(Boolean) };
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "var(--vscode-font-family, sans-serif)",
    background: "var(--vscode-editor-background)",
    color: "var(--vscode-editor-foreground)",
    padding: "12px",
    minHeight: "100vh",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  titleRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  title: {
    fontWeight: 600,
  },
  headerActions: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  errorBadge: {
    background: "var(--vscode-editorError-foreground)",
    color: "var(--vscode-editor-background)",
    padding: "2px 8px",
    borderRadius: "8px",
    fontSize: "12px",
  },
  okBadge: {
    background: "var(--vscode-testing-iconPassed)",
    color: "var(--vscode-editor-background)",
    padding: "2px 8px",
    borderRadius: "8px",
    fontSize: "12px",
  },
  bannerError: {
    background: "var(--vscode-inputValidation-errorBackground)",
    color: "var(--vscode-inputValidation-errorForeground)",
    padding: "8px",
    borderRadius: "4px",
    marginBottom: "10px",
  },
  bannerWarning: {
    background: "var(--vscode-inputValidation-warningBackground)",
    color: "var(--vscode-inputValidation-warningForeground)",
    padding: "8px",
    borderRadius: "4px",
    marginBottom: "10px",
  },
  bannerInfo: {
    background: "var(--vscode-inputValidation-infoBackground)",
    color: "var(--vscode-inputValidation-infoForeground)",
    padding: "8px",
    borderRadius: "4px",
    marginBottom: "10px",
  },
  bannerTitle: {
    fontWeight: 600,
    marginBottom: "6px",
  },
  bannerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  errorList: {
    margin: 0,
    paddingLeft: "18px",
    lineHeight: 1.4,
  },
  arraySection: {
    border: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.08))",
    borderRadius: "8px",
    padding: "10px",
    marginBottom: "12px",
    background: "var(--vscode-editorWidget-background, rgba(255,255,255,0.02))",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    marginBottom: "6px",
  },
  sectionTitle: {
    fontWeight: 600,
    display: "flex",
    gap: "4px",
    alignItems: "center",
    marginBottom: "4px",
  },
  requiredMarker: {
    color: "var(--vscode-inputValidation-errorForeground)",
    fontWeight: 700,
  },
  sectionActions: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  addButton: {
    border: "1px solid var(--vscode-button-border, var(--vscode-input-border))",
    background: "var(--vscode-button-secondaryBackground)",
    color: "var(--vscode-button-foreground)",
    borderRadius: "6px",
    padding: "4px 10px",
    cursor: "pointer",
  },
  smallButton: {
    border: "1px solid var(--vscode-button-border, var(--vscode-input-border))",
    background: "var(--vscode-button-secondaryBackground)",
    color: "var(--vscode-button-foreground)",
    borderRadius: "6px",
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: "12px",
  },
  emptyState: {
    fontStyle: "italic",
    color: "var(--vscode-descriptionForeground)",
    padding: "6px 0",
  },
  card: {
    border: "1px solid var(--vscode-input-border, rgba(255,255,255,0.1))",
    borderRadius: "8px",
    padding: "10px",
    marginTop: "8px",
    background: "var(--vscode-editor-background)",
  },
  cardHeader: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: "8px",
    alignItems: "center",
    marginBottom: "8px",
  },
  cardActionsLeft: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    minWidth: "120px",
  },
  cardTitle: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  cardActionsRight: {
    display: "flex",
    justifyContent: "flex-end",
    minWidth: "80px",
  },
  typeBadge: {
    background: "var(--vscode-inputValidation-infoBackground)",
    color: "var(--vscode-inputValidation-infoForeground)",
    borderRadius: "12px",
    padding: "2px 8px",
    fontSize: "12px",
    fontWeight: 600,
  },
  cardName: {
    fontWeight: 600,
  },
  cardActions: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  iconButton: {
    border: "1px solid var(--vscode-button-border, var(--vscode-input-border))",
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    borderRadius: "6px",
    padding: "2px 6px",
    cursor: "pointer",
    minWidth: "32px",
  },
  collapseButton: {
    border: "1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-button-border, var(--vscode-input-border)))",
    background: "var(--vscode-inputValidation-infoBackground)",
    color: "var(--vscode-inputValidation-infoForeground)",
    borderRadius: "6px",
    padding: "2px 8px",
    cursor: "pointer",
    minWidth: "32px",
  },
  dangerButton: {
    border: "1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground))",
    background: "transparent",
    color: "var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground))",
    borderRadius: "6px",
    padding: "2px 8px",
    cursor: "pointer",
  },
  placeholderButton: {
    display: "inline-block",
    minWidth: "32px",
    height: "26px",
    visibility: "hidden",
  },
  cardBody: {
    display: "grid",
    gap: "6px",
  },
  itemErrorList: {
    margin: "6px 0 0",
    paddingLeft: "18px",
    color: "var(--vscode-inputValidation-errorForeground)",
  },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: "160px 1fr",
    gap: "6px 10px",
    alignItems: "center",
  },
  fieldLabel: {
    fontWeight: 500,
  },
  fieldControl: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  inlineErrors: {
    color: "var(--vscode-inputValidation-errorForeground)",
    fontSize: "12px",
    lineHeight: 1.3,
  },
  objectSection: {
    borderRadius: "8px",
    padding: "8px 0",
  },
  objectGrid: {
    display: "grid",
    gap: "8px",
  },
  objectField: {
    width: "100%",
  },
  formErrorList: {
    background: "var(--vscode-inputValidation-warningBackground)",
    color: "var(--vscode-inputValidation-warningForeground)",
    padding: "8px",
    borderRadius: "6px",
    marginBottom: "10px",
  },
};
