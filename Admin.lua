local player = game.Players.LocalPlayer
local screenGui = Instance.new("ScreenGui", player.PlayerGui)
screenGui.Name = "GgHub"
-- O SEGREDO ESTÁ NESTA LINHA ABAIXO:
screenGui.ResetOnSpawn = false 

-- VARIÁVEIS DE COORDENADAS (Seu trabalho guardado aqui)
local categorias = {
    ["Pontos"] = {Vector3.new(345.980, 101.495, -140.667), Vector3.new(347.879, 101.189, -122.182), Vector3.new(346.829, 100.960, -105.434), Vector3.new(346.232, 101.089, -88.512), Vector3.new(346.687, 100.969, -72.366), Vector3.new(346.257, 100.823, -55.923), Vector3.new(345.563, 101.240, -37.704), Vector3.new(345.511, 101.072, -20.798), Vector3.new(344.454, 100.871, -4.069), Vector3.new(346.696, 101.180, 12.398), Vector3.new(346.782, 101.625, 29.640), Vector3.new(103.717, 205.432, -213.650), Vector3.new(347.209, 101.463, 46.016), Vector3.new(115.154, 244.747, -457.476), Vector3.new(296.872, 102.576, -270.521), Vector3.new(104.532, 114.850, -215.835)},
    ["Badges"] = {Vector3.new(346.195, 100.531, 136.662), Vector3.new(345.458, 100.364, 154.525), Vector3.new(345.673, 100.461, 171.338), Vector3.new(345.508, 101.476, 188.714), Vector3.new(345.283, 101.498, 207.521), Vector3.new(345.862, 102.239, 228.507), Vector3.new(346.060, 101.029, 244.823), Vector3.new(344.228, 101.312, 261.751), Vector3.new(347.190, 101.275, 289.199), Vector3.new(104.574, 162.964, -218.535), Vector3.new(374.613, 128.501, 149.294), Vector3.new(374.850, 128.618, 167.985), Vector3.new(374.032, 128.508, 193.301), Vector3.new(374.831, 128.408, 218.247), Vector3.new(375.010, 127.616, 235.817), Vector3.new(373.604, 128.656, 252.348), Vector3.new(372.739, 128.263, 269.170), Vector3.new(373.662, 128.694, 287.416), Vector3.new(371.767, 129.044, 303.438), Vector3.new(374.237, 128.378, 320.381), Vector3.new(371.728, 127.196, 338.099)},
    ["Erros"] = {Vector3.new(253.660, 100.451, 162.291), Vector3.new(179.870, 100.504, 64.398), Vector3.new(414.915, 135.690, 40.898)},
    ["Pass"] = {Vector3.new(104.856, 290.035, -217.173), Vector3.new(177.553, 100.981, 43.905), Vector3.new(177.271, 100.709, 26.492), Vector3.new(183.696, 100.977, -9.757), Vector3.new(178.585, 100.932, -32.489), Vector3.new(177.497, 100.407, -49.508), Vector3.new(180.142, 101.348, -68.669)},
    ["Posto"] = {Vector3.new(537.089, 101.231, 62.144)},
    ["Imortal"] = {Vector3.new(-14.639, 163.364, -215.073), Vector3.new(-14.945, 163.607, -232.781), Vector3.new(-13.869, 163.241, -248.640)}
}

-- FRAME PRINCIPAL
local main = Instance.new("Frame", screenGui)
main.Size = UDim2.new(0, 500, 0, 400)
main.Position = UDim2.new(0.5, -250, 0.5, -200)
main.BackgroundColor3 = Color3.fromRGB(20, 20, 20)
main.BorderSizePixel = 0
main.Active = true
main.Draggable = true

-- BOTÃO DE FECHAR (X Vermelho)
local closeBtn = Instance.new("TextButton", main)
closeBtn.Size = UDim2.new(0, 40, 0, 40)
closeBtn.Position = UDim2.new(1, -40, 0, 0)
closeBtn.BackgroundColor3 = Color3.fromRGB(200, 0, 0)
closeBtn.Text = "X"
closeBtn.TextColor3 = Color3.new(1, 1, 1)
closeBtn.TextSize = 20
closeBtn.Font = Enum.Font.SourceSansBold

-- MINI BOTÃO (X Arrastável preto/vermelho)
local openBtn = Instance.new("TextButton", screenGui)
openBtn.Size = UDim2.new(0, 50, 0, 50)
openBtn.Position = UDim2.new(0, 20, 0.5, 0)
openBtn.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
openBtn.BorderSizePixel = 2
openBtn.BorderColor3 = Color3.fromRGB(255, 0, 0)
openBtn.Text = "X"
openBtn.TextColor3 = Color3.fromRGB(255, 0, 0)
openBtn.TextSize = 30
openBtn.Font = Enum.Font.SourceSansBold
openBtn.Visible = false
openBtn.Draggable = true

-- TÍTULO
local title = Instance.new("TextLabel", main)
title.Size = UDim2.new(1, -40, 0, 40)
title.BackgroundColor3 = Color3.fromRGB(0, 102, 204)
title.Text = " GG HUB - MENU BRABA DEMAIS"
title.TextColor3 = Color3.new(1, 1, 1)
title.TextSize = 18
title.Font = Enum.Font.SourceSansBold
title.TextXAlignment = Enum.TextXAlignment.Left

-- ÁREA DE CATEGORIAS
local catFrame = Instance.new("Frame", main)
catFrame.Size = UDim2.new(1, -20, 0, 70)
catFrame.Position = UDim2.new(0, 10, 0, 50)
catFrame.BackgroundTransparency = 1
local catGrid = Instance.new("UIGridLayout", catFrame)
catGrid.CellSize = UDim2.new(0, 110, 0, 30)

-- ÁREA DOS BOTÕES AZUIS
local numFrame = Instance.new("ScrollingFrame", main)
numFrame.Size = UDim2.new(1, -20, 1, -160)
numFrame.Position = UDim2.new(0, 10, 0, 130)
numFrame.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
numFrame.CanvasSize = UDim2.new(0, 0, 2, 0)
local numGrid = Instance.new("UIGridLayout", numFrame)
numGrid.CellSize = UDim2.new(0, 60, 0, 40)

-- RODAPÉ
local footer = Instance.new("TextLabel", main)
footer.Size = UDim2.new(1, 0, 0, 30)
footer.Position = UDim2.new(0, 0, 1, -30)
footer.Text = "É só isso se tiver mais sans, que você faça esse trabalho kakkkak"
footer.TextColor3 = Color3.fromRGB(150, 150, 150)
footer.BackgroundTransparency = 1

-- FUNÇÕES DE ABRIR/FECHAR
closeBtn.MouseButton1Click:Connect(function()
    main.Visible = false
    openBtn.Visible = true
end)

openBtn.MouseButton1Click:Connect(function()
    main.Visible = true
    openBtn.Visible = false
end)

-- LOGICA DE CARREGAMENTO
function carregar(nome)
    for _, item in pairs(numFrame:GetChildren()) do if item:IsA("TextButton") then item:Destroy() end end
    for i, pos in ipairs(categorias[nome]) do
        local b = Instance.new("TextButton", numFrame)
        b.BackgroundColor3 = Color3.fromRGB(0, 102, 204)
        b.Text = tostring(i)
        b.TextColor3 = Color3.new(1, 1, 1)
        b.Font = Enum.Font.SourceSansBold
        b.MouseButton1Click:Connect(function()
            local character = player.Character
            if character and character:FindFirstChild("HumanoidRootPart") then
                character.HumanoidRootPart.CFrame = CFrame.new(pos + Vector3.new(0, 3, 0))
            end
        end)
    end
end

for nome, _ in pairs(categorias) do
    local cb = Instance.new("TextButton", catFrame)
    cb.BackgroundColor3 = Color3.fromRGB(50, 50, 50)
    cb.Text = nome
    cb.TextColor3 = Color3.new(1, 1, 1)
    cb.MouseButton1Click:Connect(function() carregar(nome) end)
end

carregar("Pontos")
