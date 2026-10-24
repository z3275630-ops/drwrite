/** JSON 值类型（供 fs 层与 Tiptap doc 传递用） */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
