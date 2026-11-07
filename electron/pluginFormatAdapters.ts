import path from "node:path";
import type { PluginFormat } from "./pluginDomain";

export interface PluginFormatAdapter {
  format: PluginFormat;
  extensions: readonly string[];
  scannerAvailable: boolean;
  runtimeAvailable: boolean;
  discoverForDiagnostics: boolean;
  matchesModule(modulePath: string): boolean;
  standardDirectories(environment: NodeJS.ProcessEnv): string[];
}

function adapter(
  definition: Omit<PluginFormatAdapter, "matchesModule" | "standardDirectories"> & {
    directories: (environment: NodeJS.ProcessEnv) => Array<string | undefined>;
  }
): PluginFormatAdapter {
  return {
    ...definition,
    matchesModule: modulePath => definition.extensions.some(extension => modulePath.toLocaleLowerCase().endsWith(extension)),
    standardDirectories: environment => definition.directories(environment)
      .filter((value): value is string => Boolean(value))
      .map(value => path.normalize(value))
  };
}

export const pluginFormatAdapters: readonly PluginFormatAdapter[] = [
  adapter({
    format: "VST3",
    extensions: [".vst3"],
    scannerAvailable: true,
    runtimeAvailable: true,
    discoverForDiagnostics: true,
    directories: environment => [
      environment.CommonProgramFiles && path.join(environment.CommonProgramFiles, "VST3"),
      environment.ProgramFiles && path.join(environment.ProgramFiles, "Common Files", "VST3")
    ]
  }),
  adapter({
    format: "VST2",
    extensions: [".dll"],
    scannerAvailable: false,
    runtimeAvailable: false,
    discoverForDiagnostics: true,
    directories: environment => [environment.ProgramFiles && path.join(environment.ProgramFiles, "Vstplugins")]
  }),
  adapter({
    // The CLAP slot is deliberately disabled until a native CLAP host is linked.
    // Its metadata/UI contract is ready without claiming runtime compatibility.
    format: "CLAP",
    extensions: [".clap"],
    scannerAvailable: false,
    runtimeAvailable: false,
    discoverForDiagnostics: false,
    directories: environment => [environment.CommonProgramFiles && path.join(environment.CommonProgramFiles, "CLAP")]
  })
];

export function pluginFormatAdapterForPath(modulePath: string) {
  return pluginFormatAdapters.find(candidate => candidate.matchesModule(modulePath));
}

export function discoverablePluginFormatAdapterForPath(modulePath: string) {
  const candidate = pluginFormatAdapterForPath(modulePath);
  return candidate?.discoverForDiagnostics ? candidate : undefined;
}
