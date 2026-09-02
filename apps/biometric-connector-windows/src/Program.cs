using System;
using System.Diagnostics;
using System.Globalization;
using Sabalan.Biometrics;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 1) return RunIsolated(args[0]);
        if (args.Length != 2 || args[1] != "--sdk-worker")
        {
            Console.Error.WriteLine("Usage: Sabalan.BioMini.Evaluation.exe <health|capture>");
            return 64;
        }

        return RunSdkWorker(args[0]);
    }

    private static int RunIsolated(string command)
    {
        ProcessStartInfo start = new ProcessStartInfo
        {
            FileName = Process.GetCurrentProcess().MainModule.FileName,
            Arguments = command + " --sdk-worker",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory
        };
        using (Process worker = Process.Start(start))
        {
            string output = worker.StandardOutput.ReadToEnd();
            string error = worker.StandardError.ReadToEnd();
            worker.WaitForExit();
            const string marker = "SABALAN_RESULT:";
            int markerIndex = output.LastIndexOf(marker, StringComparison.Ordinal);
            string result = markerIndex < 0 ? null : output.Substring(markerIndex + marker.Length).Trim();
            if (result == null)
            {
                result = "{\"availability\":\"UNAVAILABLE\",\"errorCategory\":\"CONNECTOR_ERROR\",\"message\":\"The isolated SDK worker did not return a normalized result.\"}";
                if (!String.IsNullOrWhiteSpace(error)) Console.Error.WriteLine(error.Trim());
                Console.WriteLine(result);
                return worker.ExitCode == 0 ? 3 : worker.ExitCode;
            }
            Console.WriteLine(result);
            return worker.ExitCode;
        }
    }

    private static int RunSdkWorker(string requestedCommand)
    {
        string command = requestedCommand.ToLowerInvariant();
        if (command != "health" && command != "capture")
        {
            Console.Error.WriteLine("Usage: Sabalan.BioMini.Evaluation.exe <health|capture>");
            return 64;
        }

        try
        {
            using (BioMiniSdkAdapter adapter = new BioMiniSdkAdapter())
            {
                DeviceEvidence device = adapter.Health();
                if (command == "health")
                {
                    WriteResult(DeviceJson(device, "AVAILABLE"));
                    return 0;
                }

                using (CaptureEvidence capture = adapter.Capture())
                {
                    WriteResult(
                        "{\"availability\":\"AVAILABLE\",\"device\":" + DeviceObject(device) +
                        ",\"captureQuality\":{\"state\":\"ACCEPTED\",\"score\":" + capture.Quality.ToString(CultureInfo.InvariantCulture) + "}" +
                        ",\"liveness\":{\"state\":\"" + capture.LivenessState + "\",\"score\":" + capture.LivenessScore.ToString(CultureInfo.InvariantCulture) + "}" +
                        ",\"template\":{\"format\":\"ISO_19794_2\",\"extracted\":true,\"materialReturned\":false}" +
                        ",\"rawImagePersisted\":false,\"errorCategory\":\"NONE\"}");
                }
                return 0;
            }
        }
        catch (BioMiniSdkException error)
        {
            WriteResult("{\"availability\":\"UNAVAILABLE\",\"errorCategory\":\"" + Escape(error.Category) + "\",\"message\":\"" + Escape(error.Message) + "\"}");
            return 2;
        }
        catch (Exception error)
        {
            WriteResult("{\"availability\":\"UNAVAILABLE\",\"errorCategory\":\"CONNECTOR_ERROR\",\"message\":\"" + Escape(error.Message) + "\"}");
            return 3;
        }
    }

    private static void WriteResult(string json)
    {
        Console.WriteLine("SABALAN_RESULT:" + json);
    }

    private static string DeviceJson(DeviceEvidence device, string availability)
    {
        return "{\"availability\":\"" + availability + "\",\"device\":" + DeviceObject(device) + ",\"errorCategory\":\"NONE\"}";
    }

    private static string DeviceObject(DeviceEvidence device)
    {
        return "{\"model\":\"" + Escape(device.Model) + "\",\"serial\":\"" + Escape(device.Serial) + "\",\"connectorVersion\":\"" + Escape(device.AdapterVersion) + "\",\"sdkVersion\":\"" + Escape(device.SdkVersion) + "\"}";
    }

    private static string Escape(string value)
    {
        if (value == null) return String.Empty;
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }
}
