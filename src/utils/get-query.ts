export function getQuery(
  queryObject: any,
  paramObject: any,
): string | undefined {
  const query = (
    queryObject.q ||
    paramObject.q ||
    queryObject.query ||
    paramObject.query
  );
  
  if (!query) return undefined;
  
  // Decode the query parameter to handle double-encoding
  try {
    let decoded = decodeURIComponent(query);
    // Check if it's double-encoded (contains %20, %2C, etc.)
    if (decoded.includes('%20') || decoded.includes('%2C') || decoded.includes('%2B')) {
      decoded = decodeURIComponent(decoded);
    }
    return decoded;
  } catch (error) {
    // If decoding fails, return the original query
    return query;
  }
}
