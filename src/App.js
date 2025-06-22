import React, { useState } from "react";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { XMLParser } from "fast-xml-parser";
import "./App.css";
import arialUnicodeMSFont from "./arial unicode ms.otf";

// Clean and normalize text content
function cleanText(text) {
  if (!text) return "";
  return text
    .trim()
    .replace(/\((<\d+>)\)/g, "$1")
    .replace(/[<>]/g, "")
    .replace(/&lt;/g, "")
    .replace(/&gt;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

// Split text into sub-questions, preserving the structure
function splitQuestions(text) {
  if (!text) return [];
  // Split on parenthesized numbers, keeping the delimiters
  const parts = text.split(/(?=\(\d+[\)\.])/).map((part) => part.trim());
  // Remove empty parts and normalize
  return parts.filter((part) => part && part.length > 0);
}

// Helper: Recursively collect all Task nodes from any object
function collectTasks(obj) {
  let tasks = [];
  if (!obj || typeof obj !== "object") return tasks;
  // Only collect if this is a real Task object (has QuestionText or Variants or Type/Score)
  if (
    obj.QuestionText !== undefined ||
    obj.Variants !== undefined ||
    obj.Type !== undefined ||
    obj.Score !== undefined
  ) {
    tasks.push(obj);
  }
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object") {
      tasks.push(...collectTasks(obj[key]));
    }
  }
  return tasks;
}

function App() {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFile = async (e) => {
    setError("");
    setPdfUrl(null);
    setLoading(true);
    const file = e.target.files[0];
    if (!file) return;

    try {
      // Load Arial Unicode MS font
      const fontResponse = await fetch(arialUnicodeMSFont);
      if (!fontResponse.ok) {
        throw new Error("Could not load font");
      }
      const fontBytes = await fontResponse.arrayBuffer();

      console.log("Starting XML parsing...");
      const xmlText = await file.text();
      const parser = new XMLParser({ ignoreAttributes: false });
      const xml = parser.parse(xmlText);

      console.log("Collecting tasks...");
      let tasks = [];
      if (xml.MyTestX?.Groups?.Group) {
        const groups = Array.isArray(xml.MyTestX.Groups.Group)
          ? xml.MyTestX.Groups.Group
          : [xml.MyTestX.Groups.Group];
        groups.forEach((g) => {
          tasks.push(...collectTasks(g));
        });
      }
      if (!tasks.length) {
        setError("Không tìm thấy câu hỏi trong file XML này.");
        return;
      }

      console.log(`Found ${tasks.length} tasks`);

      try {
        console.log("Creating PDF document...");
        const pdfDoc = await PDFDocument.create();

        // Register fontkit and embed font
        pdfDoc.registerFontkit(fontkit);
        const customFont = await pdfDoc.embedFont(fontBytes);

        let page = pdfDoc.addPage();
        const { height } = page.getSize();
        let y = height - 40;

        console.log("Processing tasks...");
        let questionCount = 0;
        for (let idx = 0; idx < tasks.length; idx++) {
          const task = tasks[idx];
          try {
            // Get question text
            let questionText = "";
            if (task.QuestionText) {
              if (typeof task.QuestionText.PlainText === "string") {
                questionText = task.QuestionText.PlainText.trim();
              }
            }
            console.log(
              `Processing task ${idx + 1}/${
                tasks.length
              }, text: ${questionText.substring(0, 50)}...`
            );

            if (!questionText) continue;

            // Add extra space between questions
            if (questionCount > 0) y -= 10;

            questionCount++;
            // Clean and split question text
            const cleanedText = cleanText(questionText);
            const subQuestions = splitQuestions(cleanedText);

            const startY = y;

            // Draw question number
            page.drawText(`Câu ${questionCount}:`, {
              x: 40,
              y: y,
              size: 12,
              font: customFont,
              color: rgb(0, 0, 0),
            });

            if (subQuestions.length > 1) {
              // Handle multiple sub-questions
              y -= 20;

              subQuestions.forEach((text, idx) => {
                // Extract the question number if it exists
                const match = text.match(/^\((\d+)[\)\.]\s*(.+)$/);
                if (match) {
                  const [_, num, content] = match;
                  // Calculate text height based on content length and width
                  const textLines = Math.ceil((content.length * 7) / 460); // Rough estimate of lines

                  page.drawText(`(${num}) ${content}`, {
                    x: 60,
                    y: y,
                    size: 12,
                    font: customFont,
                    color: rgb(0, 0, 0),
                    maxWidth: 460,
                  });

                  // Adjust y based on text height
                  y -= 20 * Math.max(1, textLines);
                } else {
                  page.drawText(text.trim(), {
                    x: 60,
                    y: y,
                    size: 12,
                    font: customFont,
                    color: rgb(0, 0, 0),
                    maxWidth: 460,
                  });
                  y -= 20;
                }
              });

              // Add extra space after multi-part questions
              y -= 10;
            } else {
              // Single question - draw on same line as question number
              const textLines = Math.ceil((cleanedText.length * 7) / 420); // Rough estimate
              page.drawText(cleanedText, {
                x: 100,
                y: startY,
                size: 12,
                font: customFont,
                color: rgb(0, 0, 0),
                maxWidth: 420,
              });
              y -= 20 * Math.max(1, textLines);
            }

            // Process variants
            try {
              let variants = [];
              if (task.Variants && task.Variants.VariantText) {
                variants = Array.isArray(task.Variants.VariantText)
                  ? task.Variants.VariantText
                  : [task.Variants.VariantText];
              }
              console.log(`Task ${idx + 1} has ${variants.length} variants`);

              // Add some padding before answers
              y -= 5;

              variants.forEach((variant, vIdx) => {
                try {
                  let optionText = variant.PlainText || "";
                  if (!optionText.trim()) return;

                  optionText = cleanText(optionText);
                  let isCorrect =
                    variant["@_CorrectAnswer"] === "True" ||
                    variant["@_CorrectAnswer"] === true ||
                    variant.CorrectAnswer === "True" ||
                    variant.CorrectAnswer === true;

                  // Calculate answer text height
                  const textLines = Math.ceil((optionText.length * 7) / 480);

                  page.drawText(
                    `${String.fromCharCode(65 + vIdx)}. ${optionText}` +
                      (isCorrect ? " ★" : ""),
                    {
                      x: 60,
                      y: y,
                      size: 11,
                      font: customFont,
                      color: isCorrect ? rgb(0, 0.5, 0) : rgb(0, 0, 0),
                      maxWidth: 480,
                    }
                  );

                  // Adjust y based on answer text height
                  y -= 18 * Math.max(1, textLines);
                } catch (variantError) {
                  console.error(
                    `Error processing variant ${vIdx} of task ${idx + 1}:`,
                    variantError
                  );
                }
              });
            } catch (variantsError) {
              console.error(
                `Error processing variants for task ${idx + 1}:`,
                variantsError
              );
            }

            // Add spacing after answers
            y -= 10;

            // Check if we need a new page
            if (y < 60) {
              console.log("Adding new page");
              y = height - 40;
              page = pdfDoc.addPage();
            }
          } catch (taskError) {
            console.error(`Error processing task ${idx + 1}:`, taskError);
          }
        }

        if (questionCount === 0) {
          throw new Error("No valid questions found to include in PDF");
        }

        console.log("Saving PDF...");
        const pdfBytes = await pdfDoc.save();
        console.log("PDF generated successfully");
        setPdfUrl(
          URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }))
        );
      } catch (pdfError) {
        console.error("PDF generation error:", pdfError);
        setError(`Lỗi khi tạo PDF: ${pdfError.message}`);
      }
    } catch (err) {
      console.error("Processing error:", err);
      setError(`Lỗi xử lý: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h2>XML to PDF Converter</h2>
      <p>Chuyển đổi file XML câu hỏi trắc nghiệm thành PDF</p>

      <div style={{ marginTop: 20 }}>
        <input
          type="file"
          accept=".xml"
          onChange={handleFile}
          disabled={loading}
          style={{
            padding: "10px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            width: "100%",
            maxWidth: "400px",
          }}
        />
      </div>

      {loading && (
        <div style={{ marginTop: 16, color: "#666" }}>Đang xử lý...</div>
      )}

      {error && (
        <div
          style={{
            color: "red",
            marginTop: 16,
            padding: "10px",
            backgroundColor: "#ffeeee",
            borderRadius: "4px",
          }}
        >
          {error}
        </div>
      )}

      {pdfUrl && (
        <div style={{ marginTop: 20 }}>
          <a
            href={pdfUrl}
            download="output.pdf"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              backgroundColor: "#4CAF50",
              color: "white",
              textDecoration: "none",
              borderRadius: "4px",
              fontWeight: "bold",
            }}
          >
            Tải xuống PDF
          </a>
          <div style={{ marginTop: 10 }}>
            <iframe
              src={pdfUrl}
              style={{
                width: "100%",
                height: "500px",
                border: "1px solid #ccc",
              }}
              title="PDF Preview"
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, color: "#888", fontSize: 13 }}>
        <p>
          Chọn file XML câu hỏi để chuyển thành PDF. Hỗ trợ định dạng MyTestX và
          các định dạng XML khác.
        </p>
      </div>
    </div>
  );
}

export default App;
