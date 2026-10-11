import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMcpConnection,
  findMcpConnection,
  getDefaultMcpConnection,
  globalConfigPath,
  readGlobalConfig,
  removeMcpConnection,
  saveMcpConnection,
  setDefaultMcpConnection,
  type SavedMcpConnection,
} from "../../src/config/global.js";

const { writes, faults } = vi.hoisted(() => ({
  writes: [] as { mode: number; directoryMode: number | undefined; contents: string }[],
  faults: { rename: false },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { dirname: directoryOf } = await import("node:path");
  const directories = new Map<number, string>();
  return {
    ...actual,
    openSync: (path: Parameters<typeof actual.openSync>[0], flags: Parameters<typeof actual.openSync>[1], mode?: Parameters<typeof actual.openSync>[2]) => {
      const fd = actual.openSync(path, flags, mode);
      directories.set(fd, directoryOf(String(path)));
      return fd;
    },
    writeFileSync: (path: Parameters<typeof actual.writeFileSync>[0], data: Parameters<typeof actual.writeFileSync>[1], options?: Parameters<typeof actual.writeFileSync>[2]) => {
      if (typeof path === "number") {
        const directory = directories.get(path);
        writes.push({
          mode: actual.fstatSync(path).mode & 0o777,
          directoryMode: directory ? actual.statSync(directory).mode & 0o777 : undefined,
          contents: typeof data === "string" ? data : "",
        });
      }
      actual.writeFileSync(path, data, options);
    },
    renameSync: (oldPath: Parameters<typeof actual.renameSync>[0], newPath: Parameters<typeof actual.renameSync>[1]) => {
      if (faults.rename) throw new Error("falha simulada ao substituir arquivo");
      actual.renameSync(oldPath, newPath);
    },
  };
});

let root = "";
let file = "";
const token = "dc_config_secret_0123456789";
const principal: SavedMcpConnection = { url: "https://docs.example/mcp", port: 443, token };
const secondary: SavedMcpConnection = { url: "https://other.example:8443/mcp", port: 8443, token: "dc_secondary_secret_9876543210" };

beforeEach(async () => {
  writes.length = 0;
  faults.rename = false;
  root = await mkdtemp(join(tmpdir(), "capivara-global-config-"));
  file = join(root, "settings", "config.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function fixture(value: unknown): Promise<string> {
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, raw, { mode: 0o600 });
  return raw;
}

async function erroDe(chamada: () => unknown): Promise<Error> {
  try {
    await chamada();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("a operação deveria ter sido recusada");
}

describe("endereço e credencial salvos", () => {
  it.each([
    ["docs.example", "443", "https://docs.example/mcp", 443],
    ["https://DOCS.example/", 443, "https://docs.example/mcp", 443],
    ["https://docs.example/custom/mcp", "8443", "https://docs.example:8443/custom/mcp", 8443],
    ["http://docs.example/mcp", "7777", "http://docs.example:7777/mcp", 7777],
    ["http://docs.example/custom/mcp", 7777, "http://docs.example:7777/custom/mcp", 7777],
    ["localhost", "7777", "http://localhost:7777/mcp", 7777],
    ["127.0.0.2", 7777, "http://127.0.0.2:7777/mcp", 7777],
    ["[::1]", 7777, "http://[::1]:7777/mcp", 7777],
    ["::1", 7777, "http://[::1]:7777/mcp", 7777],
    ["http://127.0.0.1/custom/mcp", 80, "http://127.0.0.1/custom/mcp", 80],
    ["docs.example", 1, "https://docs.example:1/mcp", 1],
    ["docs.example", 65535, "https://docs.example:65535/mcp", 65535],
  ] as const)("normaliza %s na porta %s e preserva o caminho MCP", (address, port, url, numericPort) => {
    expect(buildMcpConnection(address, port, `  ${token}  `)).toEqual({ url, port: numericPort, token });
  });

  it.each([0, 65536, 1.5, NaN, Infinity, "", "1e3", "0x50", "-1", "+443", "443.0", "443junk"])(
    "recusa porta inválida %s sem expor a credencial",
    async (port) => {
      const error = await erroDe(() => buildMcpConnection("docs.example", port, token));
      expect(error.message).not.toContain(token);
    },
  );

  it.each(["", "   ", "invalid token", "private\r\nvalue", "private\tvalue", "private\u0000value", "privateçvalue"])(
    "recusa token vazio, controle, espaço interno ou caractere não ASCII",
    async (secret) => {
      const error = await erroDe(() => buildMcpConnection("docs.example", 443, secret));
      if (secret.trim()) expect(error.message).not.toContain(secret);
    },
  );

  it.each([
    "ftp://docs.example/mcp",
    "file:///tmp/mcp",
    "https://user:private_password@docs.example/mcp",
    "https://docs.example/mcp?token=private_query",
    "https://docs.example/mcp#private_fragment",
    "https://docs.example/mcp?",
    "https://docs.example/mcp#",
  ])("recusa endereço inseguro sem reproduzir seus segredos", async (address) => {
    const error = await erroDe(() => buildMcpConnection(address, 443, token));
    for (const secret of [token, "private_password", "private_query", "private_fragment"]) {
      expect(error.message).not.toContain(secret);
    }
  });
});

describe("persistência da configuração global", () => {
  it("calcula o caminho padrão sem ler o home real e aceita um diretório explícito", () => {
    expect(globalConfigPath({})).toBe(join(homedir(), ".capybara", "config.json"));
    expect(globalConfigPath({ CAPIVARA_CONFIG_DIR: join(root, "custom") })).toBe(join(root, "custom", "config.json"));
  });

  it("arquivo ausente devolve configuração vazia sem criar nada", async () => {
    expect(await readGlobalConfig(file)).toEqual({ version: 1, mcp: { servers: [] } });
    expect(await readdir(root)).toEqual([]);
  });

  it("a primeira gravação fica em diretório 0700 e arquivo 0600, sem temporários restantes", async () => {
    await saveMcpConnection(principal, file);
    expect(await readGlobalConfig(file)).toEqual({ version: 1, mcp: { defaultUrl: principal.url, servers: [principal] } });
    expect((await stat(dirname(file))).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(dirname(file))).toEqual(["config.json"]);
  });

  it("o descritor já está privado antes do primeiro byte que contém a credencial", async () => {
    await saveMcpConnection(principal, file);
    const credentialWrites = writes.filter((write) => write.contents.includes(token));

    expect(credentialWrites.length).toBeGreaterThan(0);
    expect(credentialWrites.every((write) => write.mode === 0o600 && write.directoryMode === 0o700)).toBe(true);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("falha ao substituir o arquivo mantém a configuração anterior e elimina o temporário", async () => {
    await saveMcpConnection(principal, file);
    const before = await readFile(file, "utf8");
    faults.rename = true;
    const error = await erroDe(() => saveMcpConnection(secondary, file));

    expect(writes.some((write) => write.contents.includes(secondary.token))).toBe(true);
    expect(error.message).not.toContain(secondary.token);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readdir(dirname(file))).toEqual(["config.json"]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("adiciona outro servidor, troca o padrão e atualiza o token da mesma URL sem duplicá-la", async () => {
    await saveMcpConnection(principal, file);
    await saveMcpConnection(secondary, file);
    const rotated = { ...principal, token: "dc_rotated_secret_1357924680" };
    await saveMcpConnection(rotated, file);

    const config = await readGlobalConfig(file);
    expect(config.mcp.defaultUrl).toBe(principal.url);
    expect(config.mcp.servers).toHaveLength(2);
    expect(findMcpConnection(config, principal.url)).toEqual(rotated);
    expect(findMcpConnection(config, secondary.url)).toEqual(secondary);
    expect(getDefaultMcpConnection(config)).toEqual(rotated);
    expect(JSON.stringify(config)).not.toContain(principal.token);
  });

  it("normaliza URLs equivalentes durante o upsert e a consulta", async () => {
    await saveMcpConnection(principal, file);
    await saveMcpConnection({ ...principal, url: "https://DOCS.example:443/mcp", token: "dc_normalized_secret_2468135790" }, file);
    const config = await readGlobalConfig(file);

    expect(config.mcp.servers).toHaveLength(1);
    expect(config.mcp.defaultUrl).toBe(principal.url);
    expect(findMcpConnection(config, "https://DOCS.example:443/mcp")?.token).toBe("dc_normalized_secret_2468135790");
    expect(findMcpConnection(config, "https://docs.example/another")).toBeUndefined();
  });

  it("preserva campos desconhecidos na raiz, em mcp e no servidor atualizado", async () => {
    await fixture({
      version: 1,
      appearance: { theme: "escuro" },
      provider: "openai",
      mcp: { defaultUrl: principal.url, timeoutSeconds: 42, servers: [{ ...principal, label: "trabalho", custom: { enabled: true } }, secondary] },
    });
    await saveMcpConnection({ ...principal, token: "dc_updated_secret_1122334455" }, file);
    const config = await readGlobalConfig(file);

    expect(config).toMatchObject({ appearance: { theme: "escuro" }, provider: "openai", mcp: { timeoutSeconds: 42 } });
    expect(findMcpConnection(config, principal.url)).toMatchObject({ label: "trabalho", custom: { enabled: true }, token: "dc_updated_secret_1122334455" });
    expect(findMcpConnection(config, secondary.url)).toEqual(secondary);
  });

  it("a atualização corrige permissões antigas mais abertas", async () => {
    await saveMcpConnection(principal, file);
    await chmod(dirname(file), 0o755);
    await chmod(file, 0o644);
    await saveMcpConnection(secondary, file);

    expect((await stat(dirname(file))).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("troca o servidor padrão sem modificar as credenciais ou perder campos desconhecidos", async () => {
    await fixture({ version: 1, theme: "escuro", mcp: { defaultUrl: secondary.url, custom: true, servers: [principal, secondary] } });
    await setDefaultMcpConnection("https://DOCS.example:443/mcp", file);
    const config = await readGlobalConfig(file);

    expect(config).toMatchObject({ theme: "escuro", mcp: { custom: true, defaultUrl: principal.url } });
    expect(config.mcp.servers).toEqual([principal, secondary]);
    expect(getDefaultMcpConnection(config)).toEqual(principal);
  });

  it("não seleciona como padrão um servidor desconhecido nem altera o arquivo", async () => {
    await saveMcpConnection(principal, file);
    const before = await readFile(file, "utf8");
    const error = await erroDe(() => setDefaultMcpConnection("https://unknown.example/mcp", file));

    expect(error.message).not.toContain(token);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("ao remover o padrão, escolhe o primeiro servidor restante e remove seu token", async () => {
    await saveMcpConnection(principal, file);
    await saveMcpConnection(secondary, file);
    expect(await removeMcpConnection(secondary.url, file)).toBe(true);
    const config = await readGlobalConfig(file);

    expect(getDefaultMcpConnection(config)).toEqual(principal);
    expect(config.mcp.servers).toEqual([principal]);
    expect(await readFile(file, "utf8")).not.toContain(secondary.token);
  });

  it("remover um servidor que não é o padrão mantém o padrão atual", async () => {
    await saveMcpConnection(principal, file);
    await saveMcpConnection(secondary, file);
    expect(await removeMcpConnection(principal.url, file)).toBe(true);
    expect(getDefaultMcpConnection(await readGlobalConfig(file))).toEqual(secondary);
  });

  it("remover o último servidor deixa a lista vazia e preserva as demais configurações", async () => {
    await fixture({ version: 1, theme: "escuro", mcp: { defaultUrl: principal.url, servers: [principal] } });
    expect(await removeMcpConnection(principal.url, file)).toBe(true);
    const config = await readGlobalConfig(file);

    expect(config).toMatchObject({ theme: "escuro", mcp: { servers: [] } });
    expect(config.mcp.defaultUrl).toBeUndefined();
    expect(getDefaultMcpConnection(config)).toBeUndefined();
    expect(await readFile(file, "utf8")).not.toContain(token);
  });

  it("remover um servidor ausente não cria nem reescreve o arquivo", async () => {
    expect(await removeMcpConnection(principal.url, file)).toBe(false);
    expect(await readdir(root)).toEqual([]);
    await saveMcpConnection(principal, file);
    const before = await readFile(file, "utf8");
    expect(await removeMcpConnection(secondary.url, file)).toBe(false);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("um novo token inválido não altera a configuração válida", async () => {
    await saveMcpConnection(principal, file);
    const before = await readFile(file, "utf8");
    await erroDe(() => saveMcpConnection({ ...secondary, token: "private\r\nvalue" }, file));

    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readdir(dirname(file))).toEqual(["config.json"]);
  });

  it("JSON malformado gera erro genérico e não é substituído no salvamento", async () => {
    const raw = await fixture(`{"version":1,"token":"${token}"`);
    const readError = await erroDe(() => readGlobalConfig(file));
    const saveError = await erroDe(() => saveMcpConnection(secondary, file));

    expect(readError.message).not.toContain(token);
    expect(saveError.message).not.toContain(token);
    expect(await readFile(file, "utf8")).toBe(raw);
    expect(await readdir(dirname(file))).toEqual(["config.json"]);
  });

  it.each([
    null,
    [],
    {},
    { version: 2, mcp: { servers: [principal] } },
    { version: 1, mcp: null },
    { version: 1, mcp: { servers: {} } },
    { version: 1, mcp: { servers: [{ ...principal, port: "443" }] } },
    { version: 1, mcp: { servers: [{ ...principal, port: 0 }] } },
    { version: 1, mcp: { servers: [{ ...principal, port: 8443 }] } },
    { version: 1, mcp: { servers: [{ ...principal, token: false }] } },
    { version: 1, mcp: { servers: [{ ...principal, url: "http://docs.example/mcp" }] } },
    { version: 1, mcp: { defaultUrl: secondary.url, servers: [principal] } },
    { version: 1, mcp: { servers: [principal, { ...principal, url: "https://DOCS.example:443/mcp" }] } },
  ])("schema inválido não expõe token nem sobrescreve o arquivo", async (value) => {
    const raw = await fixture(value);
    const readError = await erroDe(() => readGlobalConfig(file));
    const saveError = await erroDe(() => saveMcpConnection(secondary, file));

    expect(readError.message).not.toContain(token);
    expect(saveError.message).not.toContain(token);
    expect(await readFile(file, "utf8")).toBe(raw);
  });

  it("mantém configurações de usuários diferentes isoladas pelo caminho informado", async () => {
    const otherFile = join(root, "other-user", "config.json");
    await saveMcpConnection(principal, file);
    await saveMcpConnection(secondary, otherFile);

    expect(getDefaultMcpConnection(await readGlobalConfig(file))).toEqual(principal);
    expect(getDefaultMcpConnection(await readGlobalConfig(otherFile))).toEqual(secondary);
    expect(findMcpConnection(await readGlobalConfig(file), secondary.url)).toBeUndefined();
  });

  it("recusa arquivo de configuração que seja symlink sem alterar o alvo", async () => {
    const target = join(root, "target.json");
    const raw = JSON.stringify({ version: 1, mcp: { defaultUrl: principal.url, servers: [principal] } });
    await writeFile(target, raw);
    await mkdir(dirname(file), { mode: 0o700 });
    await symlink(target, file);

    const error = await erroDe(() => readGlobalConfig(file));
    await erroDe(() => saveMcpConnection(secondary, file));
    expect(error.message).not.toContain(token);
    expect(await readFile(target, "utf8")).toBe(raw);
  });

  it("recusa salvar através de um diretório de configuração que seja symlink", async () => {
    const targetDir = join(root, "external");
    await mkdir(targetDir, { mode: 0o755 });
    await symlink(targetDir, dirname(file));
    await erroDe(() => saveMcpConnection(principal, file));

    expect(await readdir(targetDir)).toEqual([]);
    expect((await stat(targetDir)).mode & 0o777).toBe(0o755);
  });
});
