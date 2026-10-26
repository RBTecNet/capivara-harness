/**
 * O aplicativo desktop na aceitação operacional (item 6 de "atacar os pontos frágeis").
 *
 * A etapa 4 da redução tirou a prova fora do navegador (§134), e o produto de
 * janela nunca terminava "aceito": o build registrava o fluxo dele como
 * verificação inconclusiva, sempre. Agora a aceitação compila o projeto .NET
 * de janela e o inicia por 10 segundos: passa se o processo não terminou com
 * erro, e a árvore de processos é encerrada. Com alvo `net*-windows` fora do
 * Windows, compila com `-p:EnableWindowsTargeting=true` e registra a execução
 * como "verificação inconclusiva: plataforma".
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveAcceptance, runAcceptance, startCommandFor } from "../../src/loop/index.js";

const AVALONIA = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Avalonia" Version="11.0.10" />
  </ItemGroup>
</Project>`;

const WPF = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <UseWPF>true</UseWPF>
  </PropertyGroup>
</Project>`;

const CONSOLE = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

const LINUX_COM_TELA = { sistema: "linux" as const, tela: true };

describe("os passos do aplicativo desktop .NET", () => {
  it("Avalonia no Linux com tela: compilar, e iniciar por 10 segundos como executável de janela", () => {
    expect(deriveAcceptance({ dotnet: [{ caminho: "src/Agenda/Agenda.csproj", conteudo: AVALONIA }], plataforma: LINUX_COM_TELA })).toEqual([
      { id: "build", command: 'dotnet build "src/Agenda/Agenda.csproj"', service: false },
      { id: "start", command: 'dotnet run --no-build --project "src/Agenda/Agenda.csproj"', service: true, seconds: 10, desktop: true },
    ]);
  });

  it("alvo net*-windows fora do Windows: compila com EnableWindowsTargeting, e a execução é verificação inconclusiva: plataforma", () => {
    const [compilar, iniciar] = deriveAcceptance({ dotnet: [{ caminho: "Agenda.csproj", conteudo: WPF }], plataforma: LINUX_COM_TELA });
    expect(compilar?.command).toBe('dotnet build "Agenda.csproj" -p:EnableWindowsTargeting=true');
    expect(iniciar?.inconclusiva).toBe("plataforma");
    // No Windows o mesmo projeto compila sem a propriedade e é iniciado.
    const noWindows = deriveAcceptance({ dotnet: [{ caminho: "Agenda.csproj", conteudo: WPF }], plataforma: { sistema: "win32", tela: true } });
    expect(noWindows.map((passo) => [passo.command, passo.inconclusiva])).toEqual([['dotnet build "Agenda.csproj"', undefined], ['dotnet run --no-build --project "Agenda.csproj"', undefined]]);
  });

  it("Linux sem tela: nenhuma janela abre, e a execução também é verificação inconclusiva: plataforma", () => {
    const passos = deriveAcceptance({ dotnet: [{ caminho: "Agenda.csproj", conteudo: AVALONIA }], plataforma: { sistema: "linux", tela: false } });
    expect(passos.at(-1)?.inconclusiva).toBe("plataforma");
  });

  it("o projeto .NET que não é de janela não muda nada: a derivação continua a de antes", () => {
    expect(deriveAcceptance({ dotnet: [{ caminho: "Cli.csproj", conteudo: CONSOLE }], plataforma: LINUX_COM_TELA })).toEqual([]);
    const node = JSON.stringify({ scripts: { start: "node server.js" } });
    expect(deriveAcceptance({ packageJson: node, dotnet: [{ caminho: "Cli.csproj", conteudo: CONSOLE }], plataforma: LINUX_COM_TELA })).toEqual(deriveAcceptance({ packageJson: node }));
  });
});

describe("a aceitação de um aplicativo desktop, numa cópia limpa", () => {
  let projectRoot = "";
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "capivara-desktop-"));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const projeto = async (conteudo: string): Promise<void> => {
    await mkdir(join(projectRoot, "src", "Agenda"), { recursive: true });
    await writeFile(join(projectRoot, "src", "Agenda", "Agenda.csproj"), conteudo, "utf8");
  };
  const registrar = () => {
    const passos: { comando: string; segundos: number }[] = [];
    const runner = async (comando: string, _cwd: string, segundos: number) => {
      passos.push({ comando, segundos });
      return { exitCode: 0, output: "Build succeeded." };
    };
    return { passos, runner };
  };

  it("o executável que sobe e fica de pé 10 segundos é aceito, sem pendência", async () => {
    await projeto(AVALONIA);
    const compilar = registrar();
    const iniciar = registrar();
    const resultado = await runAcceptance({ projectRoot, runner: compilar.runner, service: iniciar.runner, plataforma: LINUX_COM_TELA });
    expect(resultado.accepted).toBe(true);
    if (resultado.accepted) expect(resultado.pendencias ?? []).toEqual([]);
    expect(compilar.passos.map((passo) => passo.comando)).toEqual(['dotnet build "src/Agenda/Agenda.csproj"']);
    expect(iniciar.passos).toEqual([{ comando: 'dotnet run --no-build --project "src/Agenda/Agenda.csproj"', segundos: 10 }]);
  });

  it("o executável que quebra ao iniciar é pego: a aceitação reprova no passo start, como defeito do produto", async () => {
    await projeto(AVALONIA);
    const resultado = await runAcceptance({
      projectRoot,
      runner: registrar().runner,
      service: async () => ({ exitCode: 134, output: "Unhandled exception. System.NullReferenceException: Object reference not set\n   at Agenda.App.OnFrameworkInitializationCompleted()" }),
      plataforma: LINUX_COM_TELA,
    });
    expect(resultado.accepted).toBe(false);
    if (!resultado.accepted) {
      expect(resultado.failure.id).toBe("start");
      expect(resultado.failure.natureza).toBe("produto");
      expect(resultado.failure.cause).toContain("NullReferenceException");
    }
  });

  it("alvo net*-windows no Linux: compila, não executa, e registra verificação inconclusiva: plataforma", async () => {
    await projeto(WPF);
    const compilar = registrar();
    const iniciar = registrar();
    const resultado = await runAcceptance({ projectRoot, runner: compilar.runner, service: iniciar.runner, plataforma: LINUX_COM_TELA });
    expect(resultado.accepted).toBe(true);
    expect(compilar.passos.map((passo) => passo.comando)).toEqual(['dotnet build "src/Agenda/Agenda.csproj" -p:EnableWindowsTargeting=true']);
    expect(iniciar.passos).toEqual([]);
    if (resultado.accepted) expect(resultado.pendencias).toEqual([expect.stringContaining("verificação inconclusiva: plataforma")]);
  });

  it("o executável de janela não é servidor: o percurso dos fluxos não o sobe", async () => {
    await projeto(AVALONIA);
    expect(await startCommandFor(projectRoot)).toBeNull();
  });
});
