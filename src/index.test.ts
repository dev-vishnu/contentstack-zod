import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  contentTypeToZod,
  contentTypeToDraftZod,
  fieldToZod,
  extractMissingFields,
  validateEntry,
  validateDraft,
  ContentstackContentType,
  ContentstackField,
  JsonRteSchema,
} from "./index";

describe("fieldToZod", () => {
  it("should handle text fields", () => {
    const field: ContentstackField = {
      uid: "title",
      data_type: "text",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    expect(schema.parse("Hello")).toBe("Hello");
    expect(() => schema.parse(123)).toThrow();
  });

  it("should handle enum/select fields", () => {
    const field: ContentstackField = {
      uid: "status",
      data_type: "text",
      mandatory: true,
      enum: {
        choices: [{ value: "draft" }, { value: "published" }, { value: "archived" }],
      },
    };

    const schema = fieldToZod(field);
    expect(schema.parse("draft")).toBe("draft");
    expect(() => schema.parse("invalid")).toThrow();
  });

  it("should handle number fields", () => {
    const field: ContentstackField = {
      uid: "count",
      data_type: "number",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse("42")).toThrow();
  });

  it("should handle boolean fields", () => {
    const field: ContentstackField = {
      uid: "active",
      data_type: "boolean",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    expect(schema.parse(true)).toBe(true);
    expect(() => schema.parse("true")).toThrow();
  });

  it("should handle isodate fields", () => {
    const field: ContentstackField = {
      uid: "created_at",
      data_type: "isodate",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    expect(schema.parse("2024-01-15T10:30:00Z")).toBe("2024-01-15T10:30:00Z");
    expect(() => schema.parse("not-a-date")).toThrow();
  });

  it("should handle file/asset fields", () => {
    const field: ContentstackField = {
      uid: "image",
      data_type: "file",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    const asset = { uid: "asset123", url: "https://example.com/image.png" };
    expect(schema.parse(asset)).toMatchObject(asset);
  });

  it("should handle link fields", () => {
    const field: ContentstackField = {
      uid: "website",
      data_type: "link",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    const link = { title: "Example", url: "https://example.com" };
    expect(schema.parse(link)).toMatchObject(link);
  });

  it("should handle reference fields", () => {
    const field: ContentstackField = {
      uid: "author",
      data_type: "reference",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    const ref = { uid: "author123", _content_type_uid: "author" };
    expect(schema.parse(ref)).toMatchObject(ref);
  });

  it("should handle optional fields", () => {
    const field: ContentstackField = {
      uid: "subtitle",
      data_type: "text",
      mandatory: false,
    };

    const schema = fieldToZod(field);
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse("Optional text")).toBe("Optional text");
  });

  it("should handle multiple fields", () => {
    const field: ContentstackField = {
      uid: "tags",
      data_type: "text",
      mandatory: true,
      multiple: true,
    };

    const schema = fieldToZod(field);
    expect(schema.parse(["tag1", "tag2"])).toEqual(["tag1", "tag2"]);
  });

  it("should handle group fields", () => {
    const field: ContentstackField = {
      uid: "seo",
      data_type: "group",
      mandatory: true,
      schema: [
        { uid: "meta_title", data_type: "text", mandatory: true },
        { uid: "meta_description", data_type: "text", mandatory: false },
      ],
    };

    const schema = fieldToZod(field);
    const group = {
      meta_title: "Page Title",
      meta_description: "Page description",
    };
    expect(schema.parse(group)).toMatchObject(group);
  });

  it("should handle multiple group fields", () => {
    const field: ContentstackField = {
      uid: "authors",
      data_type: "group",
      mandatory: true,
      multiple: true,
      schema: [
        { uid: "name", data_type: "text", mandatory: true },
        { uid: "bio", data_type: "text", mandatory: false },
      ],
    };

    const schema = fieldToZod(field);
    const groups = [
      { name: "Alice", bio: "Developer" },
      { name: "Bob" },
    ];
    expect(schema.parse(groups)).toMatchObject(groups);
  });

  it("should handle modular blocks", () => {
    const field: ContentstackField = {
      uid: "content",
      data_type: "blocks",
      mandatory: true,
      blocks: [
        {
          uid: "text_block",
          schema: [{ uid: "text", data_type: "text", mandatory: true }],
        },
        {
          uid: "image_block",
          schema: [{ uid: "image", data_type: "file", mandatory: true }],
        },
      ],
    };

    const schema = fieldToZod(field);
    const blocks = [
      { text_block: { text: "Hello world" } },
      { image_block: { image: { uid: "img123" } } },
    ];
    expect(schema.parse(blocks)).toMatchObject(blocks);
  });

  it("should handle taxonomy fields", () => {
    const field: ContentstackField = {
      uid: "categories",
      data_type: "taxonomy",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    const taxonomy = [
      { taxonomy_uid: "category", term_uid: "tech" },
      { taxonomy_uid: "category", term_uid: "news" },
    ];
    expect(schema.parse(taxonomy)).toMatchObject(taxonomy);
  });
});

describe("contentTypeToZod", () => {
  it("should create a schema from a content type", () => {
    const contentType: ContentstackContentType = {
      uid: "blog_post",
      schema: [
        { uid: "title", data_type: "text", mandatory: true },
        { uid: "body", data_type: "text", mandatory: true },
        { uid: "author", data_type: "text", mandatory: false },
      ],
    };

    const schema = contentTypeToZod(contentType);
    const entry = { title: "Test Post", body: "Content here" };
    expect(schema.parse(entry)).toMatchObject(entry);
  });

  it("should throw on invalid content type", () => {
    expect(() => contentTypeToZod({} as ContentstackContentType)).toThrow(
      "Invalid Contentstack content type schema"
    );
  });
});

describe("contentTypeToDraftZod", () => {
  it("should create a partial schema", () => {
    const contentType: ContentstackContentType = {
      uid: "blog_post",
      schema: [
        { uid: "title", data_type: "text", mandatory: true },
        { uid: "body", data_type: "text", mandatory: true },
      ],
    };

    const schema = contentTypeToDraftZod(contentType);
    // Should accept partial data
    expect(schema.parse({ title: "Only title" })).toMatchObject({
      title: "Only title",
    });
    expect(schema.parse({})).toMatchObject({});
  });
});

describe("extractMissingFields", () => {
  it("should extract missing required field paths", () => {
    const contentType: ContentstackContentType = {
      uid: "blog_post",
      schema: [
        { uid: "title", data_type: "text", mandatory: true },
        { uid: "body", data_type: "text", mandatory: true },
      ],
    };

    const schema = contentTypeToZod(contentType);
    const result = schema.safeParse({});

    if (!result.success) {
      const missing = extractMissingFields(result.error);
      expect(missing).toContain("title");
      expect(missing).toContain("body");
    }
  });
});

describe("validateEntry", () => {
  const contentType: ContentstackContentType = {
    uid: "blog_post",
    schema: [
      { uid: "title", data_type: "text", mandatory: true },
      { uid: "body", data_type: "text", mandatory: true },
    ],
  };

  it("should return success for valid entry", () => {
    const entry = { title: "Test", body: "Content" };
    const result = validateEntry(contentType, entry);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject(entry);
    }
  });

  it("should return error for invalid entry", () => {
    const result = validateEntry(contentType, { title: "Only title" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("validateDraft", () => {
  const contentType: ContentstackContentType = {
    uid: "blog_post",
    schema: [
      { uid: "title", data_type: "text", mandatory: true },
      { uid: "body", data_type: "text", mandatory: true },
    ],
  };

  it("should accept partial data", () => {
    const result = validateDraft(contentType, { title: "Only title" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ title: "Only title" });
    }
  });
});

describe("Field Descriptions for LLM", () => {
  it("should add description from field_metadata.description", () => {
    const field: ContentstackField = {
      uid: "hero_heading",
      display_name: "Hero Heading",
      data_type: "text",
      mandatory: true,
      field_metadata: {
        description: "Main headline for the hero section",
      },
    };

    const schema = fieldToZod(field);
    expect(schema.description).toBe("Main headline for the hero section");
  });

  it("should fallback to display_name when no description", () => {
    const field: ContentstackField = {
      uid: "hero_heading",
      display_name: "Hero Heading",
      data_type: "text",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    expect(schema.description).toBe("Hero Heading");
  });

  it("should fallback to uid when no display_name or description", () => {
    const field: ContentstackField = {
      uid: "hero_heading",
      data_type: "text",
      mandatory: true,
    };

    const schema = fieldToZod(field);
    expect(schema.description).toBe("hero_heading");
  });

  it("should add descriptions to nested group fields", () => {
    const field: ContentstackField = {
      uid: "seo",
      display_name: "SEO Settings",
      data_type: "group",
      mandatory: true,
      schema: [
        {
          uid: "meta_title",
          display_name: "Meta Title",
          data_type: "text",
          mandatory: true,
          field_metadata: { description: "Page title for search engines" },
        },
      ],
    };

    const schema = fieldToZod(field);
    expect(schema.description).toBe("SEO Settings");
    
    // Verify nested fields work by parsing valid data
    const validData = { meta_title: "Test Title" };
    expect(schema.parse(validData)).toMatchObject(validData);
  });
});

describe("JSON RTE Schema", () => {
  it("should validate JSON RTE content", () => {
    const validJsonRte = {
      type: "doc",
      uid: "doc123",
      children: [
        {
          type: "p",
          children: [
            { text: "Hello " },
            { text: "world", bold: true },
          ],
        },
      ],
    };

    expect(JsonRteSchema.parse(validJsonRte)).toMatchObject(validJsonRte);
  });

  it("should use JsonRteSchema for fields with allow_json_rte", () => {
    const field: ContentstackField = {
      uid: "content",
      data_type: "json",
      mandatory: true,
      field_metadata: {
        allow_json_rte: true,
      },
    };

    const schema = fieldToZod(field);
    const validContent = {
      type: "doc",
      children: [{ type: "p", children: [{ text: "Test" }] }],
    };
    expect(schema.parse(validContent)).toMatchObject(validContent);
  });
});

describe("HTML RTE Detection", () => {
  it("should handle HTML RTE fields (allow_rich_text)", () => {
    const field: ContentstackField = {
      uid: "body",
      data_type: "text",
      mandatory: true,
      field_metadata: {
        allow_rich_text: true,
        rich_text_type: "advanced",
      },
    };

    const schema = fieldToZod(field);
    const htmlContent = "<p>Hello <strong>world</strong></p>";
    expect(schema.parse(htmlContent)).toBe(htmlContent);
  });
});

describe("Regex Validation", () => {
  it("should apply regex format validation", () => {
    const field: ContentstackField = {
      uid: "email",
      data_type: "text",
      mandatory: true,
      format: "^[a-zA-Z0-9+_.-]+@[a-zA-Z0-9.-]+$",
    };

    const schema = fieldToZod(field);
    expect(schema.parse("test@example.com")).toBe("test@example.com");
    expect(() => schema.parse("not-an-email")).toThrow();
  });

  it("should handle invalid regex gracefully", () => {
    const field: ContentstackField = {
      uid: "text",
      data_type: "text",
      mandatory: true,
      format: "[invalid regex",
    };

    // Should not throw, just skip regex validation
    const schema = fieldToZod(field);
    expect(schema.parse("any text")).toBe("any text");
  });
});

describe("Date Range Constraints", () => {
  it("should enforce startDate constraint", () => {
    const field: ContentstackField = {
      uid: "event_date",
      data_type: "isodate",
      mandatory: true,
      startDate: "2024-01-01T00:00:00Z",
    };

    const schema = fieldToZod(field);
    expect(schema.parse("2024-06-15T10:00:00Z")).toBe("2024-06-15T10:00:00Z");
    expect(() => schema.parse("2023-06-15T10:00:00Z")).toThrow();
  });

  it("should enforce endDate constraint", () => {
    const field: ContentstackField = {
      uid: "event_date",
      data_type: "isodate",
      mandatory: true,
      endDate: "2024-12-31T23:59:59Z",
    };

    const schema = fieldToZod(field);
    expect(schema.parse("2024-06-15T10:00:00Z")).toBe("2024-06-15T10:00:00Z");
    expect(() => schema.parse("2025-06-15T10:00:00Z")).toThrow();
  });
});

describe("Group max_instance", () => {
  it("should enforce max_instance on repeatable groups", () => {
    const field: ContentstackField = {
      uid: "authors",
      data_type: "group",
      mandatory: true,
      multiple: true,
      max_instance: 3,
      schema: [{ uid: "name", data_type: "text", mandatory: true }],
    };

    const schema = fieldToZod(field);
    
    // Should accept up to 3 items
    expect(schema.parse([
      { name: "Alice" },
      { name: "Bob" },
      { name: "Charlie" },
    ])).toHaveLength(3);

    // Should reject more than 3 items
    expect(() => schema.parse([
      { name: "Alice" },
      { name: "Bob" },
      { name: "Charlie" },
      { name: "Dave" },
    ])).toThrow();
  });
});

describe("Upsert Mode", () => {
  it("should accept asset UID string in upsert mode", () => {
    const field: ContentstackField = {
      uid: "image",
      data_type: "file",
      mandatory: true,
    };

    const schema = fieldToZod(field, { mode: 'upsert' });
    expect(schema.parse("asset123")).toBe("asset123");
    expect(() => schema.parse({ uid: "asset123" })).toThrow();
  });

  it("should accept asset object in read mode (default)", () => {
    const field: ContentstackField = {
      uid: "image",
      data_type: "file",
      mandatory: true,
    };

    const schema = fieldToZod(field); // default is read mode
    const asset = { uid: "asset123", url: "https://example.com/image.png" };
    expect(schema.parse(asset)).toMatchObject(asset);
    expect(() => schema.parse("asset123")).toThrow();
  });

  it("should handle nested assets in groups with upsert mode", () => {
    const field: ContentstackField = {
      uid: "gallery",
      data_type: "group",
      mandatory: true,
      schema: [
        { uid: "title", data_type: "text", mandatory: true },
        { uid: "image", data_type: "file", mandatory: true },
      ],
    };

    const schema = fieldToZod(field, { mode: 'upsert' });
    const group = { title: "My Gallery", image: "asset123" };
    expect(schema.parse(group)).toMatchObject(group);
  });

  it("should handle assets in modular blocks with upsert mode", () => {
    const field: ContentstackField = {
      uid: "content",
      data_type: "blocks",
      mandatory: true,
      blocks: [
        {
          uid: "image_block",
          schema: [
            { uid: "caption", data_type: "text", mandatory: true },
            { uid: "image", data_type: "file", mandatory: true },
          ],
        },
      ],
    };

    const schema = fieldToZod(field, { mode: 'upsert' });
    const blocks = [{ image_block: { caption: "Photo", image: "asset123" } }];
    expect(schema.parse(blocks)).toMatchObject(blocks);
  });

  it("should work with contentTypeToZod in upsert mode", () => {
    const contentType: ContentstackContentType = {
      uid: "blog_post",
      schema: [
        { uid: "title", data_type: "text", mandatory: true },
        { uid: "featured_image", data_type: "file", mandatory: true },
        { uid: "gallery", data_type: "file", mandatory: false, multiple: true },
      ],
    };

    const schema = contentTypeToZod(contentType, { mode: 'upsert' });
    const entry = {
      title: "My Post",
      featured_image: "asset123",
      gallery: ["asset456", "asset789"],
    };
    expect(schema.parse(entry)).toMatchObject(entry);
  });

  it("should keep references as objects in upsert mode", () => {
    const field: ContentstackField = {
      uid: "author",
      data_type: "reference",
      mandatory: true,
    };

    const schema = fieldToZod(field, { mode: 'upsert' });
    const ref = { uid: "author123", _content_type_uid: "author" };
    expect(schema.parse(ref)).toMatchObject(ref);
  });
});
