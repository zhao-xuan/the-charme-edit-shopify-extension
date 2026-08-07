import AppKit
import CoreImage
import Foundation
import Vision

guard CommandLine.arguments.count == 3 else {
  fputs("usage: swift scripts/_segment-tote.swift INPUT OUTPUT\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let image = CIImage(contentsOf: inputURL) else {
  fputs("could not read input image\n", stderr)
  exit(1)
}

let handler = VNImageRequestHandler(ciImage: image)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let observation = request.results?.first else {
  fputs("no foreground instance detected\n", stderr)
  exit(1)
}

let maskBuffer = try observation.generateScaledMaskForImage(
  forInstances: observation.allInstances,
  from: handler
)
let mask = CIImage(cvPixelBuffer: maskBuffer)
let transparent = CIImage(color: .clear).cropped(to: image.extent)
let cutout = image.applyingFilter(
  "CIBlendWithMask",
  parameters: [
    kCIInputBackgroundImageKey: transparent,
    kCIInputMaskImageKey: mask,
  ]
)

let context = CIContext(options: [.useSoftwareRenderer: false])
try context.writePNGRepresentation(
  of: cutout,
  to: outputURL,
  format: .RGBA8,
  colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!
)