/**
 * The headers a Property photo upload must carry, and exactly those.
 *
 * The API presigns the PUT, and a SigV4 signature covers a declared set of
 * headers: send one that was not signed and the provider rejects the upload,
 * omit one that was and it rejects it too. So this set is not a matter of
 * taste — it has to match `signableHeaders` in `S3ObjectStorage`, which the
 * presign test pins to `host;x-amz-acl`.
 *
 * `x-amz-acl` is what makes the uploaded object publicly readable. It belongs
 * in the signature rather than the query string because DigitalOcean Spaces
 * ignores it in the query — the upload still returns 200 and the photo is
 * simply never readable, which is the worst of both worlds.
 *
 * It lives here, apart from the component, so the contract is testable without
 * a DOM.
 */
export function uploadHeaders(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "x-amz-acl": "public-read",
  };
}
