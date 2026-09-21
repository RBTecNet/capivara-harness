export { MCP_PROTOCOL_VERSION, McpError, createMcpClient } from "./client.js";
export type { McpClient, McpClientOptions, McpDocument, McpEndpoint, McpFile, McpResource } from "./client.js";
export { PEDIDO_SUFIXO, areaDe, asInputs, fetchProjectMaterial, listLibraryProjects, nomeDeInput, projetoDoUri, renderLibraryBlock, tipoDoDocumento, uriDoPedido } from "./library.js";
export type { LibraryProject, ProjectMaterial } from "./library.js";
export {
  AREAS,
  ARQUIVO_BASE,
  SKILLS_DIR,
  areaValida,
  escolherSkills,
  materializarSkill,
  renderSkillBlock,
  slugDaSkill,
} from "./skills.js";
export type { Area, SelecaoDeSkills, SkillMaterializada, TetoDeContexto } from "./skills.js";
