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
 * Zod Version Compatibility Helper
 * Supports both Zod v3 (.passthrough()) and v4 (looseObject)
 * ============================================================ */

type ZodObjectShape = Record<string, ZodTypeAny>;

function createLooseObject<T extends ZodObjectShape>(shape: T) {
  // Zod v4 uses z.looseObject, v3 uses z.object().passthrough()
  if (typeof (z as any).looseObject === "function") {
    return (z as any).looseObject(shape);
  }
  return z.object(shape).passthrough();
}

/* ============================================================
 * Type Definitions
 * ============================================================ */

export interface ContentstackEnumChoice {
  value: string;
}

export interface ContentstackEnum {
  choices?: ContentstackEnumChoice[];
}

export interface ContentstackBlock {
  uid: string;
  reference_to?: string;
  schema?: ContentstackField[];
}

export interface ContentstackField {
  uid: string;
  data_type: string;
  mandatory?: boolean;
  multiple?: boolean;
  enum?: ContentstackEnum;
  schema?: ContentstackField[];
  blocks?: ContentstackBlock[];
}

export interface ContentstackContentType {
  uid?: string;
  title?: string;
  schema: ContentstackField[];
}

/* ============================================================
 * Base Primitives
 * ============================================================ */

const UID = z.string().min(1);

export const AssetSchema = createLooseObject({
  uid: UID,
  url: z.string().optional(),
});

export const ReferenceSchema = createLooseObject({
  uid: UID,
  _content_type_uid: z.string().optional(),
});

export const LinkSchema = z.object({
  title: z.string().optional(),
  url: z.string().url().optional(),
});

export const IsoDateSchema = z.string().datetime();

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
      // Select field
      if (field.enum?.choices?.length) {
        const values = field.enum.choices.map((c) => c.value) as [
          string,
          ...string[]
        ];
        schema = z.enum(values);
      } else {
        schema = z.string();
      }
      break;
    }

    case "number":
      schema = z.number();
      break;

    case "boolean":
      schema = z.boolean();
      break;

    case "isodate":
      schema = IsoDateSchema;
      break;

    /* ---------- JSON / RTE / EXTENSIONS ---------- */
    case "json":
      schema = z.any();
      break;

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

      schema = z.object(groupShape);

      if (field.multiple) {
        schema = z.array(schema);
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
          });
        }

        const blockShape: Record<string, ZodTypeAny> = {};
        for (const subField of block.schema || []) {
          blockShape[subField.uid] = fieldToZod(subField);
        }

        return z.object({
          [block.uid]: z.object(blockShape),
        });
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

  /* ---------- MANDATORY ---------- */
  if (!field.mandatory) {
    schema = schema.optional();
  }

  return schema;
}

/* ============================================================
 * Content Type → Entry Zod Schema
 * ============================================================ */

export function contentTypeToZod(
  contentType: ContentstackContentType
): z.ZodObject<Record<string, ZodTypeAny>> {
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
};
