from flask import Flask, render_template, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/calcular", methods=["POST"])
def calcular():
    data = request.json
    distancia = float(data["distancia"])
    tarifa = float(data["tarifaKm"])

    costo = distancia * tarifa

    return jsonify({
        "distancia": distancia,
        "costo": round(costo, 2)
    })

if __name__ == "__main__":
    app.run(debug=True)