/**
 * Contentstack Content Type → Zod Schema Generator
 * -----------------------------------------------
 * Supports:
 * - All field types (text, number, boolean, date, json, markdown, RTE, select)
 * - References, assets, links
 * - Groups (nested + multiple)
 * - Modular blocks (including global fields)
 * - Taxonomy
 * - Extensions
 * - Mandatory / multiple handling
 *
 * DOES NOT:
 * - Enforce uniqueness
 * - Upload assets
 * - Resolve references
 * - Enforce workflow / field rules
 *
 * This is intentional.
 */

import { z, ZodTypeAny, ZodError } from "zod";

/* ============================================================
 * Zod Version Compatibility Helpers
 * Supports both Zod v3 and v4 APIs
 * ============================================================ */

type ZodObjectShape = Record<string, ZodTypeAny>;

function createLooseObject<T extends ZodObjectShape>(shape: T) {
  // Zod v4 uses z.looseObject, v3 uses z.object().passthrough()
  if (typeof (z as any).looseObject === "function") {
    return (z as any).looseObject(shape) as ReturnType<typeof z.object<T>> & {
      _input: z.infer<ReturnType<typeof z.object<T>>> & Record<string, unknown>;
      _output: z.infer<ReturnType<typeof z.object<T>>> & Record<string, unknown>;
    };
  }
  return z.object(shape).passthrough();
}

function createUrlSchema() {
  // Zod v4 uses z.url(), v3 uses z.string().url()
  if (typeof (z as any).url === "function") {
    return (z as any).url();
  }
  return z.string().url();
}

function createDatetimeSchema() {
  // Contentstack returns ISO dates which can be:
  // - Full datetime: "2011-04-02T00:00:00.000Z"
  // - Date only: "2011-04-02"
  // We accept both formats
  return z.string().refine(
    (val) => {
      // Try full datetime first
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(val)) return true;
      // Allow date-only format
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return true;
      return false;
    },
    { message: "Invalid ISO date/datetime format" }
  );
}

/* ============================================================
 * Type Definitions
 * ============================================================ */

export interface ContentstackEnumChoice {
  value: string;
  key?: string;
}

export interface ContentstackEnum {
  choices?: ContentstackEnumChoice[];
  advanced?: boolean;
}

export interface ContentstackFieldMetadata {
  description?: string;
  instruction?: string;
  markdown?: boolean;
  allow_rich_text?: boolean;
  allow_json_rte?: boolean;
  multiline?: boolean;
  rich_text_type?: string;
  default_value?: any;
  _default?: boolean;
}

export interface ContentstackTaxonomyConfig {
  taxonomy_uid: string;
  max_terms?: number;
  mandatory?: boolean;
  non_localizable?: boolean;
}

export interface ContentstackBlock {
  uid: string;
  title?: string;
  reference_to?: string;
  schema?: ContentstackField[];
}

export interface ContentstackField {
  uid: string;
  data_type: string;
  display_name?: string;
  mandatory?: boolean;
  multiple?: boolean;
  unique?: boolean;
  enum?: ContentstackEnum;
  schema?: ContentstackField[];
  blocks?: ContentstackBlock[];
  field_metadata?: ContentstackFieldMetadata;
  format?: string;
  reference_to?: string | string[];
  startDate?: string | null;
  endDate?: string | null;
  max_instance?: number;
  extensions?: string[];
  extension_uid?: string;
  taxonomies?: ContentstackTaxonomyConfig[];
}

export interface ContentstackContentType {
  uid?: string;
  title?: string;
  schema: ContentstackField[];
}

/* ============================================================
 * Description Helper for LLM Consumption
 * ============================================================ */

/**
 * Generates a minimal, clean description for a field.
 * Used by .describe() for JSON Schema generation.
 * Priority: description > display_name > uid
 */
function getFieldDescription(field: ContentstackField): string {
  return field.field_metadata?.description 
    || field.display_name 
    || field.uid;
}

/* ============================================================
 * JSON Rich Text Editor Schema
 * ============================================================ */

/**
 * Recursive schema for JSON RTE nodes.
 * Supports nested children for complex rich text structures.
 */
export const JsonRteNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    text: z.string().optional(),
    children: z.array(JsonRteNodeSchema).optional(),
    attrs: z.record(z.string(), z.any()).optional(),
    uid: z.string().optional(),
  }).passthrough()
);

/**
 * Schema for JSON Rich Text Editor content.
 * Root document with type "doc" containing child nodes.
 */
export const JsonRteSchema = z.object({
  type: z.literal("doc"),
  uid: z.string().optional(),
  attrs: z.record(z.string(), z.any()).optional(),
  children: z.array(JsonRteNodeSchema),
}).passthrough().describe("JSON Rich Text Editor content");

/* ============================================================
 * Base Primitives
 * ============================================================ */

const UID = z.string().min(1);

// Define schema shapes as constants for proper type inference
const AssetShape = {
  uid: UID,
  url: z.string().optional(),
} as const;

const ReferenceShape = {
  uid: UID,
  _content_type_uid: z.string().optional(),
} as const;

export const AssetSchema = createLooseObject(AssetShape);
export const ReferenceSchema = createLooseObject(ReferenceShape);

export const LinkSchema = z.object({
  title: z.string().optional(),
  href: z.string().optional(),  // Contentstack uses 'href' not 'url'
}).passthrough();

export const IsoDateSchema = createDatetimeSchema();

export const TaxonomySchema = z.array(
  z.object({
    taxonomy_uid: z.string(),
    term_uid: z.string(),
  })
);

/* ============================================================
 * Type Exports for Primitives
 * ============================================================ */

export type Asset = z.infer<typeof AssetSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type TaxonomyEntry = z.infer<typeof TaxonomySchema>[number];

/* ============================================================
 * Field → Zod Mapper
 * ============================================================ */

export function fieldToZod(field: ContentstackField): ZodTypeAny {
  let schema: ZodTypeAny;

  switch (field.data_type) {
    /* ---------- TEXT / STRING ---------- */
    case "text": {
      // HTML Rich Text Editor (has allow_rich_text in field_metadata)
      if (field.field_metadata?.allow_rich_text) {
        schema = z.string();
        break;
      }
      
      // Select field with enum choices
      if (field.enum?.choices?.length) {
        const values = field.enum.choices.map((c) => c.value) as [
          string,
          ...string[]
        ];
        schema = z.enum(values);
      } else {
        schema = z.string();
        // Apply regex validation if format is provided
        if (field.format) {
          try {
            schema = (schema as z.ZodString).regex(new RegExp(field.format));
          } catch {
            // Invalid regex, skip validation
          }
        }
      }
      break;
    }

    case "number":
      schema = z.number();
      break;

    case "boolean":
      schema = z.boolean();
      break;

    case "isodate": {
      schema = IsoDateSchema;
      // Add date range constraints if startDate/endDate provided
      if (field.startDate || field.endDate) {
        const startDate = field.startDate ? new Date(field.startDate) : null;
        const endDate = field.endDate ? new Date(field.endDate) : null;
        schema = z.string().datetime().refine(
          (val) => {
            const date = new Date(val);
            if (startDate && date < startDate) return false;
            if (endDate && date > endDate) return false;
            return true;
          },
          { message: "Date out of allowed range" }
        );
      }
      break;
    }

    /* ---------- JSON / RTE / EXTENSIONS ---------- */
    case "json": {
      // JSON Rich Text Editor
      if (field.field_metadata?.allow_json_rte) {
        schema = JsonRteSchema;
      } else {
        // Custom extensions or generic JSON
        schema = z.any();
      }
      break;
    }

    /* ---------- FILE ---------- */
    case "file":
      schema = AssetSchema;
      break;

    /* ---------- LINK ---------- */
    case "link":
      schema = LinkSchema;
      break;

    /* ---------- REFERENCE / GLOBAL ---------- */
    case "reference":
    case "global_field":
      schema = ReferenceSchema;
      break;

    /* ---------- TAXONOMY ---------- */
    case "taxonomy":
      schema = TaxonomySchema;
      break;

    /* ---------- GROUP ---------- */
    case "group": {
      const groupShape: Record<string, ZodTypeAny> = {};

      for (const subField of field.schema || []) {
        groupShape[subField.uid] = fieldToZod(subField);
      }

      // Add _metadata support (Contentstack adds this to repeatable groups)
      if (field.multiple) {
        groupShape["_metadata"] = z.object({
          uid: z.string().optional(),
        }).passthrough().optional();
      }

      schema = z.object(groupShape).passthrough();

      if (field.multiple) {
        schema = z.array(schema);
        // Apply max_instance constraint for repeatable groups
        if (field.max_instance && field.max_instance > 0) {
          schema = (schema as z.ZodArray<any>).max(field.max_instance);
        }
      }
      break;
    }

    /* ---------- MODULAR BLOCKS ---------- */
    case "blocks": {
      const blockSchemas: ZodTypeAny[] = (field.blocks || []).map((block) => {
        // Global field inside blocks
        if (block.reference_to) {
          return z.object({
            [block.uid]: ReferenceSchema,
          }).passthrough();
        }

        const blockShape: Record<string, ZodTypeAny> = {};
        for (const subField of block.schema || []) {
          blockShape[subField.uid] = fieldToZod(subField);
        }
        // Add _metadata support (Contentstack adds this to block items)
        blockShape["_metadata"] = z.object({
          uid: z.string().optional(),
        }).passthrough().optional();

        return z.object({
          [block.uid]: z.object(blockShape).passthrough(),
        }).passthrough();
      });

      if (blockSchemas.length === 0) {
        schema = z.array(z.any());
      } else if (blockSchemas.length === 1) {
        schema = z.array(blockSchemas[0]);
      } else {
        // Zod union requires at least 2 elements
        const [first, second, ...rest] = blockSchemas;
        schema = z.array(z.union([first, second, ...rest]));
      }
      break;
    }

    /* ---------- FALLBACK ---------- */
    default:
      schema = z.any();
  }

  /* ---------- MULTIPLE ---------- */
  if (
    field.multiple &&
    field.data_type !== "group" &&
    field.data_type !== "blocks"
  ) {
    schema = z.array(schema);
  }

  /* ---------- MANDATORY + NULLABLE ---------- */
  // Contentstack returns `null` for empty optional fields
  if (!field.mandatory) {
    schema = schema.nullable().optional();
  }

  /* ---------- DESCRIPTION FOR LLM ---------- */
  schema = schema.describe(getFieldDescription(field));

  return schema;
}

/* ============================================================
 * Content Type → Entry Zod Schema
 * ============================================================ */

export function contentTypeToZod(
  contentType: ContentstackContentType
) {
  if (!contentType?.schema) {
    throw new Error("Invalid Contentstack content type schema");
  }

  const shape: Record<string, ZodTypeAny> = {};

  for (const field of contentType.schema) {
    shape[field.uid] = fieldToZod(field);
  }

  return z.object(shape);
}

/* ============================================================
 * Optional Helpers
 * ============================================================ */

/**
 * Creates a partial/draft schema where all fields are optional.
 * Useful for LLM-generated content or partial input validation.
 */
export function contentTypeToDraftZod(contentType: ContentstackContentType) {
  return contentTypeToZod(contentType).partial();
}

/**
 * Extract missing required fields from a Zod validation error.
 * Returns an array of dot-notation field paths.
 * Compatible with both Zod v3 and v4 error formats.
 */
export function extractMissingFields(zodError: ZodError): string[] {
  return zodError.issues
    .filter((issue) => {
      if (issue.code !== "invalid_type") return false;
      // Zod v3: has `received` property
      if ("received" in issue && (issue as any).received === "undefined") return true;
      // Zod v4: check message for "undefined"
      if (issue.message?.includes("received undefined")) return true;
      return false;
    })
    .map((issue) => issue.path.join("."));
}

/**
 * Validates an entry against a content type schema.
 * Returns a result object with success status and data/error.
 */
export function validateEntry<T>(
  contentType: ContentstackContentType,
  entry: unknown
): { success: true; data: T } | { success: false; error: ZodError } {
  const schema = contentTypeToZod(contentType);
  const result = schema.safeParse(entry);

  if (result.success) {
    return { success: true, data: result.data as T };
  }

  return { success: false, error: result.error };
}

/**
 * Validates a draft entry (partial validation).
 * Useful for validating incomplete entries during editing.
 */
export function validateDraft<T>(
  contentType: ContentstackContentType,
  entry: unknown
): { success: true; data: T } | { success: false; error: ZodError } {
  const schema = contentTypeToDraftZod(contentType);
  const result = schema.safeParse(entry);

  if (result.success) {
    return { success: true, data: result.data as T };
  }

  return { success: false, error: result.error };
}

/* ============================================================
 * Default Export
 * ============================================================ */

export default {
  contentTypeToZod,
  contentTypeToDraftZod,
  fieldToZod,
  extractMissingFields,
  validateEntry,
  validateDraft,
  // Primitive schemas
  AssetSchema,
  ReferenceSchema,
  LinkSchema,
  IsoDateSchema,
  TaxonomySchema,
  // JSON RTE schemas
  JsonRteSchema,
  JsonRteNodeSchema,
};
