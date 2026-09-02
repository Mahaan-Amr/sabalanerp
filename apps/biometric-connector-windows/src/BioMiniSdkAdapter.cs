using System;
using BioMini;

namespace Sabalan.Biometrics
{
    internal sealed class CaptureEvidence : IDisposable
    {
        internal byte[] Template;
        internal int TemplateSize;
        internal int Quality;
        internal int LivenessScore;
        internal string LivenessState;

        public void Dispose()
        {
            if (Template != null) Array.Clear(Template, 0, Template.Length);
            Template = null;
            TemplateSize = 0;
        }
    }

    internal sealed class DeviceEvidence
    {
        internal string Model;
        internal string Serial;
        internal string SdkVersion;
        internal string AdapterVersion;
    }

    internal sealed class VerificationEvidence
    {
        internal DeviceEvidence Device;
        internal int Quality;
        internal string LivenessState;
        internal int LivenessScore;
        internal bool Matched;
        internal float MatchScore;
    }

    internal sealed class BioMiniSdkException : Exception
    {
        internal readonly string Category;

        internal BioMiniSdkException(string category, string message) : base(message)
        {
            Category = category;
        }
    }

    internal sealed class BioMiniSdkAdapter : IDisposable
    {
        private const int MaxTemplateSize = 4096;
        private const int Iso19794TemplateType = 2002;
        private const int ApprovedScannerType = 1008; // UFS_SCANNER_TYPE.SFR700 / BioMini Slim 2
        private const int FakeDetectionLevel = 1;
        private const int CaptureTimeoutMilliseconds = 15000;
        private const int MinimumExtractionQuality = 40;
#if SABALAN_PRODUCTION
        private const string AdapterVersion = "1.0.0";
#else
        private const string AdapterVersion = "0.1.0-evaluation";
#endif

        private readonly UFScannerManager scannerManager;
        private readonly UFMatcher matcher;
        private UFScanner scanner;
        private bool initialized;

        internal BioMiniSdkAdapter()
        {
            scannerManager = new UFScannerManager(null);
            matcher = new UFMatcher();
            if (matcher.InitResult != UFM_STATUS.OK)
                throw new BioMiniSdkException("SDK_LICENSE_INVALID", MatcherError(matcher.InitResult));
            matcher.nTemplateType = Iso19794TemplateType;
            matcher.SecurityLevel = 4;
            matcher.FastMode = true;
        }

        internal DeviceEvidence Health()
        {
            EnsureInitialized();
            return Device();
        }

        internal CaptureEvidence Capture()
        {
            EnsureInitialized();
            scanner.Timeout = CaptureTimeoutMilliseconds;
            scanner.nTemplateType = Iso19794TemplateType;
            scanner.TemplateSize = MaxTemplateSize;
            scanner.DetectFake = FakeDetectionLevel;
            if (scanner.DetectFake <= 0)
                throw new BioMiniSdkException("LIVENESS_UNAVAILABLE", "The scanner did not enable live-finger detection.");

            UFS_STATUS captureStatus = scanner.CaptureSingleImage();
            if (Convert.ToInt32(captureStatus) == -221)
                throw new BioMiniSdkException("LIVENESS_FAILED", "The SDK rejected a fake finger.");
            RequireScannerOk(captureStatus, NormalizeScannerCategory(captureStatus));

            byte[] template = new byte[MaxTemplateSize];
            int templateSize;
            int quality;
            UFS_STATUS extractStatus = scanner.ExtractEx(MaxTemplateSize, template, out templateSize, out quality);
            if (extractStatus != UFS_STATUS.OK)
            {
                Array.Clear(template, 0, template.Length);
                RequireScannerOk(extractStatus, "POOR_CAPTURE_QUALITY");
            }
            if (quality < MinimumExtractionQuality)
            {
                Array.Clear(template, 0, template.Length);
                throw new BioMiniSdkException("POOR_CAPTURE_QUALITY", "The extracted fingerprint quality is below the configured acceptance threshold.");
            }

            int livenessScore = scanner.LfdScore;
            return new CaptureEvidence
            {
                Template = template,
                TemplateSize = templateSize,
                Quality = quality,
                LivenessScore = livenessScore,
                LivenessState = "LIVE"
            };
        }

        internal VerificationEvidence Verify(byte[] expectedTemplate, int expectedTemplateSize)
        {
            if (expectedTemplate == null || expectedTemplateSize <= 0 || expectedTemplateSize > expectedTemplate.Length)
                throw new ArgumentException("An expected ISO template is required.", "expectedTemplate");

            using (CaptureEvidence probe = Capture())
            {
                bool matched;
                float score;
                UFM_STATUS status = matcher.VerifyEx(
                    probe.Template,
                    probe.TemplateSize,
                    expectedTemplate,
                    expectedTemplateSize,
                    out score,
                    out matched);
                if (status != UFM_STATUS.OK)
                    throw new BioMiniSdkException("MATCHER_ERROR", MatcherError(status));
                return new VerificationEvidence
                {
                    Device = Device(),
                    Quality = probe.Quality,
                    LivenessState = probe.LivenessState,
                    LivenessScore = probe.LivenessScore,
                    Matched = matched,
                    MatchScore = score
                };
            }
        }

        private void EnsureInitialized()
        {
            if (initialized) return;
            UFS_STATUS status = scannerManager.Init();
            RequireScannerOk(status, NormalizeScannerCategory(status));
            initialized = true;
            if (scannerManager.Scanners.Count != 1)
                throw new BioMiniSdkException("DEVICE_COUNT_INVALID", "Exactly one approved scanner must be connected.");
            scanner = scannerManager.Scanners[0];
            if (scanner == null)
                throw new BioMiniSdkException("DEVICE_DISCONNECTED", "The scanner is unavailable.");
            if (Convert.ToInt32(scanner.ScannerType) != ApprovedScannerType)
                throw new BioMiniSdkException("UNSUPPORTED_DEVICE", "The connected scanner is not a BioMini Slim 2.");
            if (String.IsNullOrWhiteSpace(scanner.Serial))
                throw new BioMiniSdkException("DEVICE_IDENTITY_INVALID", "The scanner did not expose a stable serial number.");
            string allowedSerial = Environment.GetEnvironmentVariable("SABALAN_BIOMETRIC_ALLOWED_SERIAL");
            if (String.IsNullOrWhiteSpace(allowedSerial))
                throw new BioMiniSdkException("CONFIGURATION_ERROR", "SABALAN_BIOMETRIC_ALLOWED_SERIAL must identify the approved scanner.");
            if (!String.Equals(scanner.Serial, allowedSerial.Trim(), StringComparison.Ordinal))
                throw new BioMiniSdkException("DEVICE_IDENTITY_INVALID", "The connected scanner serial is not allowlisted.");
        }

        private DeviceEvidence Device()
        {
            return new DeviceEvidence
            {
                Model = "BioMini SLIM 2",
                Serial = scanner.Serial,
                SdkVersion = typeof(UFScannerManager).Assembly.GetName().Version.ToString(),
                AdapterVersion = AdapterVersion
            };
        }

        private static string NormalizeScannerCategory(UFS_STATUS status)
        {
            int code = Convert.ToInt32(status);
            if (code == -241 || code == -11) return "CAPTURE_TIMEOUT";
            if (code == -10 || code == -12 || code == -530 || code == -540) return "DEVICE_DISCONNECTED";
            if (code == -101 || code == -102 || code == -103 || code == -204) return "SDK_LICENSE_INVALID";
            if (code == -211 || code == -212) return "RETRYABLE_CONNECTOR_ERROR";
            return "CONNECTOR_ERROR";
        }

        private static void RequireScannerOk(UFS_STATUS status, string category)
        {
            if (status == UFS_STATUS.OK) return;
            string message;
            UFScanner.GetErrorString(status, out message);
            throw new BioMiniSdkException(category, message);
        }

        private static string MatcherError(UFM_STATUS status)
        {
            string message;
            UFMatcher.GetErrorString(status, out message);
            return message;
        }

        public void Dispose()
        {
            if (!initialized) return;
            scannerManager.Uninit();
            initialized = false;
            scanner = null;
        }
    }
}
