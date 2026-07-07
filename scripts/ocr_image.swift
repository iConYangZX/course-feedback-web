import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count >= 2 else {
  FileHandle.standardError.write(Data("Missing image path\n".utf8))
  exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])

guard
  let image = NSImage(contentsOf: imageURL),
  let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
  FileHandle.standardError.write(Data("Unable to read image\n".utf8))
  exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
  try handler.perform([request])
  let text = (request.results ?? [])
    .compactMap { $0.topCandidates(1).first?.string }
    .joined(separator: "\n")

  print(text)
} catch {
  FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
  exit(1)
}
