declare module "juice/client" {
  import type juice from "juice";
  const client: Pick<typeof juice, "inlineContent">;
  export default client;
}
