export async function sha256(buf: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", buf);
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, "0");
	}
	return hex;
}

/**
 * SMPL-VS-002: standard base64 (with `+/=` padding) sha256 digest of the buffer.
 * Used as the value of the `x-amz-checksum-sha256` header for R2 PUTs so that
 * R2 verifies the upload's integrity before our `complete` call accepts it.
 *
 * Currently the server derives this server-side from the hex sha and bakes it
 * into the presigned URL's signed headers + the `headers` map returned from
 * init, so the client just forwards those headers. This helper is exported for
 * symmetry and in case we ever want to compute/cross-check it locally.
 */
export async function sha256Base64(buf: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", buf);
	const bytes = new Uint8Array(digest);
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}
