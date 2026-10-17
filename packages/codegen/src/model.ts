/**
 * The type model: a language-neutral description of one ref's content types,
 * produced by the Coho server. See `type-model.schema.json` in coho-sdk-spec.
 *
 * Only what the generator reads is declared here. Readers ignore keys they do not
 * know, which is what lets a minor version add them.
 */

export interface TypeModel
{
    readonly irVersion: string;
    readonly source: Source;
    /** Content types by slug. */
    readonly types: Readonly<Record<string, ContentType>>;
    readonly warnings?: readonly ModelWarning[];
}

export interface Source
{
    readonly project: string;
    /** The branch or tag the types came from. */
    readonly ref: string;
    /** True for a tag, whose types can never change. */
    readonly immutable: boolean;
    readonly schemaHash: string;
}

export interface ContentType
{
    readonly slug: string;
    readonly name: string;
    readonly version: string;
    readonly fields: readonly Field[];
}

export interface Field
{
    readonly id: string;
    readonly name: string;
    /** Open: a kind added after this generator was written is emitted untyped. */
    readonly kind: string;
    /** Whether delivery always includes the field. The one rule for optionality. */
    readonly presence: 'always' | 'maybe';
    readonly required: boolean;
    readonly localized: boolean;
    readonly sortable: boolean;
    readonly many?: boolean;
    /** Reference targets, each a key of `types`; or a repeater's component types. */
    readonly of?: readonly string[];
    readonly values?: readonly string[];
    readonly textFormat?: string;
    readonly min?: number;
    readonly max?: number;
}

export interface ModelWarning
{
    readonly type: string;
    readonly field: string;
    readonly message: string;
}

/** The type model's major version this generator reads. */
export const SUPPORTED_MAJOR = 1;

/** A type model, a configuration or a server answer the generator cannot use. */
export class CodegenError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = 'CodegenError';
    }
}

/**
 * Checks that `json` is a type model this generator can read, and returns it. An
 * unknown major version is refused: the shape may mean something this generator
 * cannot know.
 */
export function readTypeModel(json: unknown): TypeModel
{
    if (!isObject(json)) throw new CodegenError('The type model is not a JSON object');

    const version = json['irVersion'];
    if (typeof version !== 'string' || !/^\d+\.\d+$/.test(version))
    {
        throw new CodegenError(`The type model has no valid irVersion: ${JSON.stringify(version)}`);
    }
    const major = Number(version.split('.')[0]);
    if (major !== SUPPORTED_MAJOR)
    {
        throw new CodegenError(`The type model is version ${version}; this generator reads ${SUPPORTED_MAJOR}.x. Upgrade @coho-cms/codegen.`);
    }

    if (!isObject(json['source'])) throw new CodegenError('The type model has no source');
    if (!isObject(json['types'])) throw new CodegenError('The type model has no types');
    for (const [slug, type] of Object.entries(json['types']))
    {
        if (!isObject(type) || !Array.isArray(type['fields']))
        {
            throw new CodegenError(`Type '${slug}' in the type model has no fields`);
        }
    }
    return json as unknown as TypeModel;
}

function isObject(value: unknown): value is Record<string, unknown>
{
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
