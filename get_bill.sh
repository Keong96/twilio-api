#!/bin/bash

# ================= 默认设置 =================
YEAR=$(date +%Y)
MONTH=$(date +%m)

# ================= 参数解析 =================
for arg in "$@"; do
    key=$(echo "$arg" | tr '[:upper:]' '[:lower:]')
    case $key in
        -jan|jan) MONTH="01" ;;
        -feb|feb) MONTH="02" ;;
        -mar|mar) MONTH="03" ;;
        -apr|apr) MONTH="04" ;;
        -may|may) MONTH="05" ;;
        -jun|jun) MONTH="06" ;;
        -jul|jul) MONTH="07" ;;
        -aug|aug) MONTH="08" ;;
        -sep|sep) MONTH="09" ;;
        -oct|oct) MONTH="10" ;;
        -nov|nov) MONTH="11" ;;
        -dec|dec) MONTH="12" ;;
        -20[0-9][0-9]|20[0-9][0-9]) YEAR="${arg#-}" ;;
    esac
done

# ================= 设置保存目录 =================
# 创建一个专门存放当月账单的文件夹
SAVE_DIR="bills_${YEAR}-${MONTH}"

if [ ! -d "$SAVE_DIR" ]; then
    echo "📂 创建文件夹: $SAVE_DIR"
    mkdir -p "$SAVE_DIR"
else
    echo "📂 文件将保存至: $SAVE_DIR"
fi

# ================= 用户数据 =================
customers=(
    "test2@email.com|+60393880246"
    "hengonghuat128896@outlook.com|+60393880513"
    "jacwong92@gmail.com|+60360430722,+60360430846,+60360430522,+60360430761"
    "fookkokkhiong1998@gmail.com|+60360431506,+60360431494,+60360431458,+60360431419,+60360430724"
    "Tanboonheong81@gmail.com|+60393880547,+60360431453,+60360431429,+60360431439,+60360430580"
    "Joshepine.chen9090@gmail.com|+60360430616,+60360430786,+60360430824,+60360430779"
    "teoyeeling92@gmail.com|+60360430807,+60360430823,+60360430713,+60360430740"
    "Sdlcq888@gmail.com|+60393880549"
    "teamwork12688@gmail.com|+60360431414,+60360431519"
)

# ================= 主程序 =================
echo "==========================================="
echo "正在下载并计算账单: $YEAR-$MONTH"
echo "==========================================="
echo ""

for row in "${customers[@]}"; do
    IFS="|" read -r email numbers <<< "$row"
    
    echo "User: $email"
    
    user_subtotal=0
    IFS="," read -r -a num_array <<< "$numbers"
    
    for num in "${num_array[@]}"; do
        # 1. URL 编码
        encoded_num=$(echo "$num" | sed 's/+/%2B/g')
        url="https://make-call.online/export-call-history/$encoded_num?month=$MONTH&year=$YEAR"
        
        # 2. 设置保存路径 (直接保存到文件夹中，不删除了)
        file_name="${num}.csv"
        file_path="${SAVE_DIR}/${file_name}"
        
        # 3. 下载文件
        curl -s -L "$url" -o "$file_path"

        # 4. Python 计算金额
        amount=$(python3 -c "
import pandas as pd
try:
    # 读取下载好的文件
    df = pd.read_csv('$file_path')
    cols = [c for c in df.columns if any(k in str(c).lower() for k in ['cost', 'amount', 'total', 'price', '金额'])]
    if cols:
        val = df[cols[0]].sum()
        print(f'{float(val):.2f}')
    else:
        print('0.00')
except:
    print('0.00')
" 2>/dev/null)

        # 5. 显示结果
        printf "  %-15s : %s USD  [已保存]\n" "$num" "$amount"
        user_subtotal=$(awk "BEGIN {printf \"%.2f\", $user_subtotal + $amount}")
        
        # 注意：这里不再运行 rm -f，文件会被保留
    done

    printf "  Subtotal        : %s USD\n" "$user_subtotal"
    echo "----------------------------------"
done

echo ""
echo "✅ 所有账单文件已保存在文件夹: $SAVE_DIR/"
echo "你可以进入该文件夹查看或发送给客户。"
