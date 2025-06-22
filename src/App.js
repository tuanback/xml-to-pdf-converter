import React, { useState } from "react";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { XMLParser } from "fast-xml-parser";
import "./App.css";

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

  const handleFile = async (e) => {
    setError("");
    setPdfUrl(null);
    const file = e.target.files[0];
    if (!file) return;

    try {
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

        // Register fontkit before embedding custom font
        pdfDoc.registerFontkit(fontkit);

        // Embed the font
        console.log("Embedding font...");
        const fontBytes = await fetch("/arial unicode ms.otf").then((res) =>
          res.arrayBuffer()
        );
        const customFont = await pdfDoc.embedFont(fontBytes);

        let page = pdfDoc.addPage();
        const { width, height } = page.getSize();
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

            questionCount++;
            page.drawText(`Câu ${questionCount}: ${questionText}`, {
              x: 40,
              y: y,
              size: 12,
              font: customFont,
              color: rgb(0, 0, 0),
            });
            y -= 20;

            // Process variants
            try {
              let variants = [];
              if (task.Variants && task.Variants.VariantText) {
                variants = Array.isArray(task.Variants.VariantText)
                  ? task.Variants.VariantText
                  : [task.Variants.VariantText];
              }
              console.log(`Task ${idx + 1} has ${variants.length} variants`);

              variants.forEach((variant, vIdx) => {
                try {
                  let optionText = variant.PlainText || "";
                  if (!optionText.trim()) return;

                  let isCorrect =
                    variant["@_CorrectAnswer"] === "True" ||
                    variant["@_CorrectAnswer"] === true ||
                    variant.CorrectAnswer === "True" ||
                    variant.CorrectAnswer === true;

                  page.drawText(
                    `${String.fromCharCode(65 + vIdx)}. ${optionText}` +
                      (isCorrect ? " (Đúng)" : ""),
                    {
                      x: 60,
                      y: y,
                      size: 11,
                      font: customFont,
                      color: isCorrect ? rgb(0, 0.5, 0) : rgb(0, 0, 0),
                    }
                  );
                  y -= 16;
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

            y -= 10;
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
          style={{
            padding: "10px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            width: "100%",
            maxWidth: "400px",
          }}
        />
      </div>

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
