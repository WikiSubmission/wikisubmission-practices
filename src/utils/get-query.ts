export function getQuery(
  queryObject: any,
  paramObject: any,
): string | undefined {
  return (
    queryObject.q ||
    paramObject.q ||
    queryObject.query ||
    paramObject.query
  )?.replace("/s/g", "%20");
}
