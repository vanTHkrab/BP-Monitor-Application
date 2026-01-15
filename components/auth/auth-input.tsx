import { AppColors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { TextInput, View } from 'react-native';

interface AuthInputProps {
  icon: keyof typeof Ionicons.glyphMap;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

export function AuthInput({
  icon,
  placeholder,
  value,
  onChangeText,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
}: AuthInputProps) {
  return (
    <View className="flex-row items-center bg-white rounded-full px-5 py-3.5 mb-3 border border-gray-200">
      <Ionicons
        name={icon}
        size={20}
        color={AppColors.gray400}
        style={{ marginRight: 12 }}
      />
      <TextInput
        className="flex-1 text-[15px] text-gray-800"
        placeholder={placeholder}
        placeholderTextColor={AppColors.gray400}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}
