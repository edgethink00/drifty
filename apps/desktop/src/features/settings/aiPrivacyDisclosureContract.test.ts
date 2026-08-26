import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { AI_DISCLOSED_WIRE_FIELDS } from "./AiPrivacyReview";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS } from "../localization/translations";

/**
 * The privacy panel's field list is written by hand. Nothing else notices when the real
 * outbound payload gains a field, so this test reads the request builders and fails when
 * the wire shape and the disclosure drift apart.
 */
const CLASSIFICATION_SERVICE_PATH = "src/features/classification/aiClassificationService.ts";
const LOCAL_PROVIDER_REQUEST_PATH = "src/features/classification/localAiProviderRequest.ts";
const classificationService = readFileSync(CLASSIFICATION_SERVICE_PATH, "utf8");
const localProviderRequest = readFileSync(LOCAL_PROVIDER_REQUEST_PATH, "utf8");

const FIX_INSTRUCTIONS = [
  "The AI privacy panel promises users an exhaustive list of what leaves this computer.",
  "A field reached the outbound request without a matching disclosure.",
  "",
  "To fix, do BOTH of these:",
  "  1. Disclose the field to users. Add a row in AiPrivacyReview.tsx (REQUIRED_ROW_COPY or",
  "     OPTIONAL_ROW_COPY) with en + ko copy under settings.aiPrivacy.*, or, if it is an",
  "     identifier rather than activity content, name it in settings.aiPrivacy.footnote.",
  "  2. Add the field to AI_DISCLOSED_WIRE_FIELDS in AiPrivacyReview.tsx, mapping it to the",
  "     translation key that discloses it.",
  "",
  "Do NOT silence this test by deleting the field from the list below. The list is derived",
  "from the real request builders; if the field is genuinely no longer sent, remove it from",
  "toLiveClassificationPromptItem / toMinimizedPayload / promptItem instead.",
].join("\n");

const EXTRACTOR_INSTRUCTIONS = [
  "This contract parses the request builders with the TypeScript compiler, so it reads the",
  "real object shape rather than pattern-matching text. It refuses to guess: a builder it",
  "cannot resolve fails the suite instead of silently disclosing nothing.",
  "",
  "If a builder legitimately started using a construct the extractor does not resolve yet,",
  "teach objectLiteralsFrom() about that construct. Do not narrow the check or delete it —",
  "an extractor that quietly returns no keys is how an undisclosed field ships.",
].join("\n");

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

type BuilderSource = {
  readonly path: string;
  readonly file: ts.SourceFile;
};

/** Recursion guard plus the builder name used in failure messages. */
type ExtractionContext = {
  readonly source: BuilderSource;
  readonly builder: string;
  readonly visited: Set<ts.Node>;
};

function builderSource(path: string, text: string): BuilderSource {
  return { path, file: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true) };
}

const CLASSIFICATION_SERVICE_SOURCE = builderSource(CLASSIFICATION_SERVICE_PATH, classificationService);
const LOCAL_PROVIDER_REQUEST_SOURCE = builderSource(LOCAL_PROVIDER_REQUEST_PATH, localProviderRequest);

function extractionError(context: ExtractionContext, message: string): Error {
  return new Error(
    context.builder + " in " + context.source.path + ": " + message + "\n\n" + EXTRACTOR_INSTRUCTIONS,
  );
}

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

/** Every declaration of `name`, so an ambiguous rename fails loudly instead of picking one. */
function findFunctions(source: BuilderSource, name: string): readonly FunctionLike[] {
  const found: FunctionLike[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      isFunctionLike(node.initializer)
    ) {
      found.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source.file, visit);
  return found;
}

/** Expressions this function returns, ignoring returns that belong to nested callbacks. */
function returnedExpressions(fn: FunctionLike): readonly ts.Expression[] {
  const body = fn.body;
  if (!body) return [];
  if (!ts.isBlock(body)) return [body];

  const expressions: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) {
      if (node.expression) expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return expressions;
}

function resultLiterals(context: ExtractionContext, fn: FunctionLike): readonly ts.ObjectLiteralExpression[] {
  // Cycle guard only: the entry is released afterwards so a helper spread by two builders
  // still resolves the second time.
  if (context.visited.has(fn)) return [];
  context.visited.add(fn);
  try {
    return returnedExpressions(fn).flatMap((expression) => objectLiteralsFrom(context, expression));
  } finally {
    context.visited.delete(fn);
  }
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) return unwrap(expression.expression);
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return unwrap(expression.expression);
  if (ts.isNonNullExpression(expression)) return unwrap(expression.expression);
  return expression;
}

/**
 * Resolves an expression to the object literal(s) it can produce. Every branch a value can
 * take is followed, because a field that only ships on one branch still ships.
 */
function objectLiteralsFrom(context: ExtractionContext, expression: ts.Expression): readonly ts.ObjectLiteralExpression[] {
  const node = unwrap(expression);

  if (ts.isObjectLiteralExpression(node)) return [node];

  if (ts.isConditionalExpression(node)) {
    return [...objectLiteralsFrom(context, node.whenTrue), ...objectLiteralsFrom(context, node.whenFalse)];
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
  ) {
    return [...objectLiteralsFrom(context, node.left), ...objectLiteralsFrom(context, node.right)];
  }

  // A builder that maps over a batch — payload.map((item) => ({ ... })) — hides the wire
  // shape inside the callback.
  if (ts.isCallExpression(node)) {
    const callbackLiterals = node.arguments
      .filter((argument): argument is ts.FunctionExpression | ts.ArrowFunction =>
        ts.isFunctionExpression(argument) || ts.isArrowFunction(argument))
      .flatMap((callback) => resultLiterals(context, callback));
    if (callbackLiterals.length > 0) return callbackLiterals;

    const callee = ts.isIdentifier(node.expression) ? node.expression.text : null;
    const target = callee ? findFunctions(context.source, callee) : [];
    if (target.length === 1 && target[0]) return resultLiterals(context, target[0]);
  }

  throw extractionError(
    context,
    "could not resolve " + ts.SyntaxKind[node.kind] + " `" + node.getText().slice(0, 80) + "` to an object shape",
  );
}

function propertyKey(context: ExtractionContext, name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  throw extractionError(
    context,
    "uses a computed property name (`" + name.getText().slice(0, 80) + "`) that cannot be verified statically",
  );
}

/** Every key an object literal contributes, following spreads into the shapes they carry. */
function literalKeys(context: ExtractionContext, literal: ts.ObjectLiteralExpression): readonly string[] {
  return literal.properties.flatMap((property): readonly string[] => {
    if (ts.isPropertyAssignment(property)) return [propertyKey(context, property.name)];
    if (ts.isShorthandPropertyAssignment(property)) return [property.name.text];
    if (ts.isSpreadAssignment(property)) {
      return objectLiteralsFrom(context, property.expression).flatMap((spread) => literalKeys(context, spread));
    }
    if (ts.isMethodDeclaration(property) || ts.isGetAccessor(property) || ts.isSetAccessor(property)) {
      return [propertyKey(context, property.name)];
    }
    throw extractionError(
      context,
      "has an object member this contract cannot read: " + (property as ts.Node).getText().slice(0, 80),
    );
  });
}

/**
 * Keys of the request item a builder produces, read off the parsed source. Covers
 * `key: value`, shorthand `{ key }`, conditional spreads, and spreads of other builders,
 * with no positional window to fall out of.
 */
function itemKeysFrom(source: BuilderSource, functionName: string): readonly string[] {
  const declarations = findFunctions(source, functionName);
  if (declarations.length === 0) {
    throw new Error(
      functionName + " was not found in " + source.path + ". It was renamed or removed, so this contract " +
        "can no longer verify the outbound shape. Point the test at the new builder rather than deleting the check.",
    );
  }
  if (declarations.length > 1) {
    throw new Error(
      functionName + " has " + declarations.length + " declarations in " + source.path + ", so this contract " +
        "cannot tell which one builds the request. Disambiguate the builder name.",
    );
  }

  const declaration = declarations[0];
  if (!declaration) throw new Error(functionName + " resolved to no declaration in " + source.path + ".");
  const context: ExtractionContext = { source, builder: functionName, visited: new Set<ts.Node>() };
  const literals = resultLiterals(context, declaration);
  if (literals.length === 0) {
    throw extractionError(context, "returns no object literal this contract can read, so it would disclose nothing");
  }

  const keys = [...new Set(literals.flatMap((literal) => literalKeys(context, literal)))];
  if (keys.length === 0) {
    throw extractionError(context, "produced zero wire fields, which means the extraction is broken rather than the payload empty");
  }
  return keys;
}

describe("AI privacy disclosure contract", () => {
  it("discloses every field the cloud and local prompt items carry", () => {
    // Given
    const promptItemKeys = itemKeysFrom(CLASSIFICATION_SERVICE_SOURCE, "toLiveClassificationPromptItem");
    const localPromptKeys = itemKeysFrom(LOCAL_PROVIDER_REQUEST_SOURCE, "promptItem");
    const wireFields = [...new Set([...promptItemKeys, ...localPromptKeys])];

    // Non-vacuity: an extractor that silently reads nothing would pass every check below.
    // These fields are unconditionally present in both builders, so their absence means the
    // extraction broke, not that the payload shrank.
    expect(promptItemKeys, "toLiveClassificationPromptItem extraction returned nothing usable").toEqual(
      expect.arrayContaining(["id", "appName", "durationSeconds"]),
    );
    expect(localPromptKeys, "promptItem extraction returned nothing usable").toEqual(
      expect.arrayContaining(["id", "appName", "durationSeconds", "enhancedContext"]),
    );

    // When
    const undisclosed = wireFields.filter((field) => !(field in AI_DISCLOSED_WIRE_FIELDS));

    // Then
    expect(
      undisclosed,
      "Undisclosed outbound field(s): " + undisclosed.join(", ") + "\n\n" + FIX_INSTRUCTIONS,
    ).toEqual([]);
  });

  it("discloses every field the minimized payload sends to the cloud edge function", () => {
    // Given
    const edgeItemKeys = itemKeysFrom(CLASSIFICATION_SERVICE_SOURCE, "toEdgeClassificationRequestItems");

    // Non-vacuity: this builder spreads toLiveClassificationPromptItem, so it must carry that
    // builder's fields plus its own inputFingerprint. Asserting them keeps an empty extraction
    // from passing as a clean bill of health — the exact way this case was vacuous before.
    expect(edgeItemKeys, "toEdgeClassificationRequestItems extraction returned nothing usable").toEqual(
      expect.arrayContaining(["id", "inputFingerprint", "appName", "domain", "urlHost", "durationSeconds", "siteUrl", "title"]),
    );

    // When
    const undisclosed = edgeItemKeys.filter((field) => !(field in AI_DISCLOSED_WIRE_FIELDS));

    // Then
    expect(
      undisclosed,
      "Undisclosed outbound field(s): " + undisclosed.join(", ") + "\n\n" + FIX_INSTRUCTIONS,
    ).toEqual([]);
  });

  it("keeps every disclosure mapping pointed at real, localized copy", () => {
    // Given
    const mappedKeys = Object.values(AI_DISCLOSED_WIRE_FIELDS);

    // When
    const missing = mappedKeys.filter((key) => !ENGLISH_TRANSLATIONS[key] || !KOREAN_TRANSLATIONS[key]);

    // Then
    expect(
      missing,
      "AI_DISCLOSED_WIRE_FIELDS points at translation key(s) with no en/ko copy: " + missing.join(", "),
    ).toEqual([]);
  });

  it("states the per-segment volume of recent-activity context, never 'one per request'", () => {
    // buildClassificationMemoryContext keys episodeByItemId per segment, so a 20-segment
    // batch carries up to 20 episode sets. Understating outbound volume is the one
    // direction a privacy disclosure must never err.
    const memoryContext = readFileSync("src/features/classification/classificationMemoryContext.ts", "utf8");
    expect(memoryContext).toContain("episodeByItemId[item.id]");

    for (const translations of [ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS]) {
      expect(
        translations["settings.aiPrivacy.meaningMemory"],
        "Recent-activity copy must not claim one summary per request; it is built per segment.",
      ).not.toMatch(/one per request|요청당 하나(?!입니다\.$)/);
    }

    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.meaningMemory"]).toMatch(/every segment|per segment/i);
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.meaningMemory"]).toContain("구간마다");
  });

  it("scopes the client version and device id claim to the cloud route", () => {
    // cloudApiClientMetadata and withCloudDevicePayload are cloud-only; the local
    // provider request carries neither, so BYOK users must not be told otherwise.
    expect(localProviderRequest).not.toContain("cloudApiClientMetadata");
    expect(localProviderRequest).not.toContain("withCloudDevicePayload");

    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.footnote"]).toMatch(/cloud route only/i);
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.footnote"]).toContain("클라우드로 보낼 때만");
  });

  it("keeps the Reddit partial-send rule conditional on a Reddit domain", () => {
    // redditCommunityForSegment bails out unless the domain matches REDDIT_DOMAIN_PATTERN,
    // so the rule may only ever be stated as a Reddit-scoped condition.
    expect(classificationService).toMatch(/if \(!siteDomain \|\| !REDDIT_DOMAIN_PATTERN\.test\(siteDomain\)\) return null;/);

    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.redditNote"]).toMatch(/Reddit/);
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.redditNote"]).toContain("Reddit");
  });

  it("discloses both Reddit derivation paths, not only the address one", () => {
    // redditCommunityForSegment falls back to the site title and then the window title
    // whenever content context is on, so Page address being off does not stop the
    // community from being sent. Both paths need their own note.
    expect(classificationService).toContain("extractRedditCommunityFromUrl(siteUrl)");
    expect(classificationService).toMatch(
      /titleEnabled \? extractRedditCommunityFromText\(segment\.siteTitle\) \?\? extractRedditCommunityFromText\(segment\.windowTitle\)/,
    );

    for (const translations of [ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS]) {
      expect(translations["settings.aiPrivacy.redditNoteTitle"]).toContain("Reddit");
    }
    // The title-path note must point at the title, not repeat the address rule.
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.redditNoteTitle"]).toMatch(/title/i);
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.redditNoteTitle"]).toContain("제목");
  });

  it("discloses enhancedContext with its own copy instead of a row that disclaims it", () => {
    // enhancedContext is a real outbound field on the local/BYOK route. Mapping it to copy
    // that says it is "not covered by this row" would silence the contract rather than
    // disclose the field.
    expect(localProviderRequest).toContain("...(enhancedContext ? { enhancedContext } : {})");
    expect(AI_DISCLOSED_WIRE_FIELDS.enhancedContext).toBe("settings.aiPrivacy.meaningEnhancedContext");

    for (const translations of [ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS]) {
      const copy = translations["settings.aiPrivacy.meaningEnhancedContext"];
      expect(copy, "Enhanced context copy must not disclaim covering the field it discloses.").not.toMatch(
        /not covered by this row|이 항목과 무관/,
      );
    }
    // The payload carries these per item (enhancedPromptItems), so the copy names them.
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toMatch(/depth/i);
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toMatch(/on by default/i);
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).not.toMatch(/Dev-gated|Dev settings/i);
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toContain("기본으로 켜져");
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).not.toContain("개발자 모드");
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toMatch(/conversation title\/type/i);
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toMatch(/terminal commands/i);
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toContain("AI 대화 제목·유형");
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toContain("터미널 명령");

    // The cloud edge builder carries no enhancedContext field, so the copy must scope the
    // claim to local/self-hosted/BYOK routes rather than implying the cloud route receives it too.
    const edgeItemKeys = itemKeysFrom(CLASSIFICATION_SERVICE_SOURCE, "toEdgeClassificationRequestItems");
    expect(edgeItemKeys).not.toContain("enhancedContext");
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toMatch(/local, self-hosted, or bring-your-own-key/i);
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.meaningEnhancedContext"]).toContain("클라우드 경로는 이 항목을 받지 않습니다");
  });

  it("describes classification samples as service-side and account-deletion linked", () => {
    // ai_classification_records is service-role only and keyed by salted hashes, not
    // auth.users.id. Users cannot browse individual rows, while the delete-account
    // path derives current and retained hashes and removes matching samples.
    for (const translations of [ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS]) {
      expect(
        translations["settings.aiPrivacy.footnote"],
        "Samples are not stored in the user's account; they are service-role rows keyed by a salted hash.",
      ).not.toMatch(/stored in your Drifty account|Drifty 계정에 저장/);
    }
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.footnote"]).toMatch(/salted account hashes/i);
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.footnote"]).toMatch(/deleting the account removes samples/i);
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.footnote"]).toMatch(/blocks.*24 hours.*expired marker.*later sample-cleanup/i);
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.footnote"]).toContain("계정을 삭제하면");
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.footnote"]).toMatch(/24시간 차단.*만료된 표식.*이후 샘플 정리/);
  });

  it("discloses the truncation limit for both window title and page address", () => {
    expect(classificationService).toContain("const MAX_TEXT_LENGTH = 160;");
    expect(classificationService).toMatch(/\.slice\(0, 300\)/);

    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.noteWindowTitle"]).toContain("160");
    expect(ENGLISH_TRANSLATIONS["settings.aiPrivacy.noteSiteUrl"]).toContain("300");
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.noteWindowTitle"]).toContain("160");
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.noteSiteUrl"]).toContain("300");
  });
});
