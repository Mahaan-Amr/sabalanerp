using System;
using System.Diagnostics;
using System.Globalization;
using Sabalan.Biometrics;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 1)
        {
            string publicCommand = args[0].ToLowerInvariant();
            if (publicCommand != "health" && publicCommand != "capture")
            {
                Console.Error.WriteLine("Only health and non-material capture are available from the public command line.");
                return 64;
            }
            return RunIsolated(publicCommand);
        }
        if (args.Length != 2 || args[1] != "--sdk-worker")
        {
            Console.Error.WriteLine("Usage: Sabalan.BioMini.Adapter.exe <health|capture>");
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
        if (command != "health" && command != "capture" && command != "capture-template" && command != "verify")
        {
            Console.Error.WriteLine("Usage: Sabalan.BioMini.Adapter.exe <health|capture>");
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

                if (command == "verify")
                {
                    byte[] expectedTemplate = null;
                    try
                    {
                        expectedTemplate = ReadBoundedTemplate(Console.OpenStandardInput(), 4096);
                        if (expectedTemplate.Length == 0)
                            throw new BioMiniSdkException("INVALID_COMMAND", "The expected ISO template size is invalid.");
                        VerificationEvidence verification = adapter.Verify(expectedTemplate, expectedTemplate.Length);
                        WriteResult(
                            "{\"availability\":\"AVAILABLE\",\"device\":" + DeviceObject(verification.Device) +
                            ",\"captureQuality\":{\"state\":\"ACCEPTED\",\"score\":" + verification.Quality.ToString(CultureInfo.InvariantCulture) + "}" +
                            ",\"liveness\":{\"state\":\"" + verification.LivenessState + "\",\"score\":" + verification.LivenessScore.ToString(CultureInfo.InvariantCulture) + "}" +
                            ",\"match\":{\"state\":\"" + (verification.Matched ? "MATCH" : "NO_MATCH") + "\",\"score\":" + verification.MatchScore.ToString(CultureInfo.InvariantCulture) + "}" +
                            ",\"errorCategory\":\"" + (verification.Matched ? "NONE" : "NO_MATCH") + "\"}");
                        return 0;
                    }
                    finally
                    {
                        if (expectedTemplate != null) Array.Clear(expectedTemplate, 0, expectedTemplate.Length);
                    }
                }

                using (CaptureEvidence capture = adapter.Capture())
                {
                    string result =
                        "{\"availability\":\"AVAILABLE\",\"device\":" + DeviceObject(device) +
                        ",\"captureQuality\":{\"state\":\"ACCEPTED\",\"score\":" + capture.Quality.ToString(CultureInfo.InvariantCulture) + "}" +
                        ",\"liveness\":{\"state\":\"" + capture.LivenessState + "\",\"score\":" + capture.LivenessScore.ToString(CultureInfo.InvariantCulture) + "}" +
                        (command == "capture-template" ? ",\"templateFormat\":\"ISO_19794_2\",\"templateLength\":" + capture.TemplateSize.ToString(CultureInfo.InvariantCulture) : ",\"template\":{\"format\":\"ISO_19794_2\",\"extracted\":true,\"materialReturned\":false}") +
                        ",\"rawImagePersisted\":false,\"errorCategory\":\"NONE\"}";
                    if (command == "capture-template") WriteTemplateResult(result, capture.Template, capture.TemplateSize);
                    else WriteResult(result);
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

    private static void WriteTemplateResult(string json, byte[] template, int size)
    {
        Console.WriteLine("SABALAN_TEMPLATE_RESULT:" + json);
        Console.Out.Flush();
        System.IO.Stream output = Console.OpenStandardOutput();
        output.Write(template, 0, size);
        output.Flush();
    }

    private static byte[] ReadBoundedTemplate(System.IO.Stream input, int maximum)
    {
        byte[] buffer = new byte[maximum + 1];
        int total = 0;
        while (total < buffer.Length)
        {
            int read = input.Read(buffer, total, buffer.Length - total);
            if (read == 0) break;
            total += read;
        }
        if (total == 0 || total > maximum)
        {
            Array.Clear(buffer, 0, buffer.Length);
            throw new BioMiniSdkException("INVALID_COMMAND", "The expected template pipe input is invalid.");
        }
        byte[] exact = new byte[total];
        Buffer.BlockCopy(buffer, 0, exact, 0, total);
        Array.Clear(buffer, 0, buffer.Length);
        return exact;
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
