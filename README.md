# contentstack-zod

Convert [Contentstack](https://www.contentstack.com/) content type schemas to [Zod](https://zod.dev/) validation schemas at runtime.

## Features

- **Full field type support**: text, number, boolean, date, JSON, markdown, RTE, select/enum
- **Complex structures**: references, assets, links, groups, modular blocks, taxonomy
- **Nested content**: groups with multiple items, global fields in blocks
- **Validation helpers**: mandatory/optional fields, multiple values
- **Draft mode**: partial validation for incomplete entries
- **TypeScript**: full type definitions included

### What it doesn't do (by design)

- Enforce uniqueness constraints
- Upload assets
- Resolve references
- Enforce workflow or field rules

## Installation

```bash
npm install contentstack-zod zod
# or
yarn add contentstack-zod zod
# or
pnpm add contentstack-zod zod
```

> **Note**: `zod` is a peer dependency and must be installed separately.

## Quick Start

```typescript
import { contentTypeToZod, contentTypeToDraftZod } from "contentstack-zod";

// Fetch your content type from Contentstack
const contentType = await contentstack.contentType("blog_post").fetch();

// Create a strict validation schema
const BlogPostSchema = contentTypeToZod(contentType);

// Create a draft schema (all fields optional)
const DraftSchema = contentTypeToDraftZod(contentType);

// Validate an entry
const result = BlogPostSchema.safeParse(entry);
if (result.success) {
  console.log("Valid entry:", result.data);
} else {
  console.error("Validation errors:", result.error.issues);
}
```

## API Reference

### `contentTypeToZod(contentType)`

Converts a Contentstack content type to a Zod schema where mandatory fields are required.

```typescript
import { contentTypeToZod } from "contentstack-zod";

const schema = contentTypeToZod(contentType);
schema.parse(entry); // throws ZodError if invalid
schema.safeParse(entry); // returns { success, data } or { success, error }
```

### `contentTypeToDraftZod(contentType)`

Creates a partial schema where all fields are optional. Useful for:
- LLM-generated content
- Partial/draft entries
- Form validation during editing

```typescript
import { contentTypeToDraftZod } from "contentstack-zod";

const draftSchema = contentTypeToDraftZod(contentType);
draftSchema.parse({ title: "Just a title" }); // OK, even if body is required
```

### `fieldToZod(field)`

Convert a single Contentstack field definition to a Zod schema.

```typescript
import { fieldToZod } from "contentstack-zod";

const field = {
  uid: "title",
  data_type: "text",
  mandatory: true,
};

const schema = fieldToZod(field);
```

### `validateEntry(contentType, entry)`

Validate an entry and get a typed result.

```typescript
import { validateEntry } from "contentstack-zod";

const result = validateEntry(contentType, entry);

if (result.success) {
  console.log(result.data); // typed entry data
} else {
  console.log(result.error); // ZodError
}
```

### `validateDraft(contentType, entry)`

Validate a partial/draft entry.

```typescript
import { validateDraft } from "contentstack-zod";

const result = validateDraft(contentType, partialEntry);
```

### `extractMissingFields(zodError)`

Extract missing required field paths from a Zod error.

```typescript
import { extractMissingFields } from "contentstack-zod";

const result = schema.safeParse(entry);
if (!result.success) {
  const missing = extractMissingFields(result.error);
  console.log("Missing fields:", missing);
  // ["title", "seo.meta_title", "content.0.text_block.text"]
}
```

## Exported Primitive Schemas

You can also import the base schemas used internally:

```typescript
import {
  AssetSchema,
  ReferenceSchema,
  LinkSchema,
  IsoDateSchema,
  TaxonomySchema,
} from "contentstack-zod";

// Use for custom validation
const customSchema = z.object({
  featured_image: AssetSchema,
  related_posts: z.array(ReferenceSchema),
});
```

## Field Type Mapping

| Contentstack Type | Zod Schema |
|-------------------|------------|
| `text` | `z.string()` |
| `text` (with enum) | `z.enum([...])` |
| `number` | `z.number()` |
| `boolean` | `z.boolean()` |
| `isodate` | `z.string().datetime()` |
| `json` | `z.any()` |
| `file` | `AssetSchema` |
| `link` | `LinkSchema` |
| `reference` | `ReferenceSchema` |
| `global_field` | `ReferenceSchema` |
| `taxonomy` | `TaxonomySchema` |
| `group` | `z.object({...})` |
| `blocks` | `z.array(z.union([...]))` |

### Field Modifiers

- **`mandatory: true`** → field is required
- **`mandatory: false`** → field is optional (`.optional()`)
- **`multiple: true`** → field is an array (`z.array(...)`)

## TypeScript Types

```typescript
import type {
  ContentstackContentType,
  ContentstackField,
  ContentstackBlock,
  ContentstackEnum,
  Asset,
  Reference,
  Link,
  TaxonomyEntry,
} from "contentstack-zod";
```

## Examples

### Basic Blog Post

```typescript
const blogType = {
  uid: "blog_post",
  schema: [
    { uid: "title", data_type: "text", mandatory: true },
    { uid: "slug", data_type: "text", mandatory: true },
    { uid: "body", data_type: "json", mandatory: true },
    { uid: "published_at", data_type: "isodate", mandatory: false },
    { uid: "tags", data_type: "text", mandatory: false, multiple: true },
  ],
};

const schema = contentTypeToZod(blogType);

schema.parse({
  title: "Hello World",
  slug: "hello-world",
  body: { type: "doc", content: [] },
  tags: ["welcome", "first-post"],
});
```

### With Groups and Modular Blocks

```typescript
const pageType = {
  uid: "page",
  schema: [
    { uid: "title", data_type: "text", mandatory: true },
    {
      uid: "seo",
      data_type: "group",
      mandatory: true,
      schema: [
        { uid: "meta_title", data_type: "text", mandatory: true },
        { uid: "meta_description", data_type: "text", mandatory: false },
      ],
    },
    {
      uid: "content",
      data_type: "blocks",
      mandatory: true,
      blocks: [
        {
          uid: "hero",
          schema: [
            { uid: "heading", data_type: "text", mandatory: true },
            { uid: "image", data_type: "file", mandatory: true },
          ],
        },
        {
          uid: "text_section",
          schema: [
            { uid: "body", data_type: "json", mandatory: true },
          ],
        },
      ],
    },
  ],
};

const schema = contentTypeToZod(pageType);

schema.parse({
  title: "Home Page",
  seo: {
    meta_title: "Welcome to Our Site",
    meta_description: "The best site ever",
  },
  content: [
    {
      hero: {
        heading: "Welcome!",
        image: { uid: "hero-img-123", url: "https://..." },
      },
    },
    {
      text_section: {
        body: { type: "doc", content: [] },
      },
    },
  ],
});
```

### LLM Content Generation

```typescript
import { contentTypeToDraftZod, extractMissingFields, contentTypeToZod } from "contentstack-zod";

// 1. Validate LLM output (partial OK)
const draftSchema = contentTypeToDraftZod(contentType);
const llmOutput = await generateWithLLM(prompt);
draftSchema.parse(llmOutput);

// 2. Check what's still missing
const fullSchema = contentTypeToZod(contentType);
const result = fullSchema.safeParse(llmOutput);

if (!result.success) {
  const missing = extractMissingFields(result.error);
  console.log("Still need:", missing);
  // Prompt user or LLM to fill in missing fields
}
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

## License

MIT
