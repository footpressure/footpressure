# 新建 convert_csv_to_json.py 脚本
import pandas as pd
import json

# 读取 CSV（与原程序的 sample_pressure.csv 对应）
df = pd.read_csv('data/sample_pressure.csv', header=None)
# 转为 JSON 数组（每行对应一帧数据）
data = df.values.tolist()
with open('data/pressure_data.json', 'w') as f:
    json.dump(data, f)