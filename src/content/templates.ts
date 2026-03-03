import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "../utils/config.js";

export interface TemplateVariable {
  name: string;
  description: string;
  required?: boolean;
  default?: string;
}

export interface ContentTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  body: string;
  variables: TemplateVariable[];
  tips?: string[];
  example_output?: string;
}

function getBuiltinTemplatesDir(): string {
  // When running from dist/, templates/ is at the package root
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // src/content/ or dist/content/ → go up 2 levels to package root
  return join(currentDir, "..", "..", "templates");
}

function loadTemplatesFromDir(dir: string): ContentTemplate[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const data = readFileSync(join(dir, f), "utf-8");
    return JSON.parse(data) as ContentTemplate;
  });
}

export function listTemplates(category?: string): ContentTemplate[] {
  const builtIn = loadTemplatesFromDir(getBuiltinTemplatesDir());
  const userTemplates = loadTemplatesFromDir(config.userTemplatesDir);

  let all = [...builtIn, ...userTemplates];

  if (category) {
    all = all.filter((t) => t.category === category);
  }

  return all.map((t) => ({
    ...t,
    body: t.body.substring(0, 200) + (t.body.length > 200 ? "..." : ""),
  }));
}

export function getTemplate(templateId: string): ContentTemplate | null {
  const builtIn = loadTemplatesFromDir(getBuiltinTemplatesDir());
  const userTemplates = loadTemplatesFromDir(config.userTemplatesDir);
  const all = [...builtIn, ...userTemplates];
  return all.find((t) => t.id === templateId) || null;
}

export function saveTemplate(data: {
  name: string;
  category?: string;
  body: string;
  variables?: TemplateVariable[];
}): { template_id: string; saved: boolean } {
  const id = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const template: ContentTemplate = {
    id,
    name: data.name,
    category: data.category || "custom",
    description: "",
    body: data.body,
    variables: data.variables || [],
  };

  const filePath = join(config.userTemplatesDir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(template, null, 2));

  return { template_id: id, saved: true };
}

export function applyTemplate(
  templateId: string,
  vars: Record<string, string>,
): string | null {
  const template = getTemplate(templateId);
  if (!template) return null;

  let result = template.body;

  // Replace {{variable}} with values
  for (const v of template.variables) {
    const value = vars[v.name] || v.default || "";
    result = result.replace(new RegExp(`\\{\\{${v.name}\\}\\}`, "g"), value);
  }

  // Replace any remaining unmatched variables with empty string
  result = result.replace(/\{\{[^}]+\}\}/g, "");

  return result.trim();
}
