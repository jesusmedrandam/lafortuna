export function ok(res, data, meta) {
    return res.status(200).json({ ok: true, data, ...(meta ? { meta } : {}) });
}
export function created(res, data) {
    return res.status(201).json({ ok: true, data });
}
export function noContent(res) { return res.status(204).send(); }
//# sourceMappingURL=http.js.map